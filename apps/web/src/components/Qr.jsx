import React, { useEffect, useRef, useState } from 'react';

/** رمز QR كـ SVG (يُطبع بوضوح تام). المكتبة تُحمَّل عند الحاجة فقط */
export function QrSvg({ text, size = 220, className = '' }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    if (!text) { setSvg(''); return undefined; }
    import('qrcode').then((m) => (m.default || m).toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0e4f4d', light: '#ffffff' } }))
      .then((s) => { if (alive) setSvg(s); })
      .catch(() => { if (alive) setSvg(''); });
    return () => { alive = false; };
  }, [text]);
  return (
    <div className={`qr-box inline-block rounded-xl bg-white p-2 ${className}`} style={{ width: size, height: size }} data-qr={text ? 'ready' : 'empty'}
      dangerouslySetInnerHTML={svg ? { __html: svg.replace('<svg', `<svg width="${size - 16}" height="${size - 16}"`) } : undefined} />
  );
}

/**
 * ماسح QR بالكاميرا الخلفية: BarcodeDetector الأصلي (Chrome/Android) أو jsQR كبديل (Safari/iPhone).
 * onResult(text) عند أول قراءة ناجحة.
 */
export function QrScanner({ onResult, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [state, setState] = useState('starting'); // starting | scanning | error
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let stream = null; let raf = 0; let stopped = false; let detector = null; let jsQR = null;
    const stop = () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) return stop();
        const v = videoRef.current;
        v.srcObject = stream;
        v.setAttribute('playsinline', '');
        await v.play();
        if ('BarcodeDetector' in window) {
          try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
        }
        if (!detector) jsQR = (await import('jsqr')).default;
        setState('scanning');
        let last = 0;
        const tick = async (t) => {
          if (stopped) return;
          raf = requestAnimationFrame(tick);
          if (t - last < 180 || v.readyState < 2) return; // ~5 إطارات/ث تكفي وتوفر البطارية
          last = t;
          try {
            let text = null;
            if (detector) {
              const codes = await detector.detect(v);
              text = codes?.[0]?.rawValue || null;
            } else {
              const c = canvasRef.current;
              const w = Math.min(640, v.videoWidth); const h = Math.round((v.videoHeight / v.videoWidth) * w);
              c.width = w; c.height = h;
              const ctx = c.getContext('2d', { willReadFrequently: true });
              ctx.drawImage(v, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              text = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data || null;
            }
            if (text) { stop(); navigator.vibrate?.(60); onResult?.(text); }
          } catch { /* إطار غير صالح — نكمل */ }
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setState('error');
        const m = e?.name === 'NotAllowedError' ? 'اسمح للمتصفح باستخدام الكاميرا ثم أعد المحاولة'
          : e?.message === 'insecure' ? 'الكاميرا تحتاج اتصالاً آمناً (https)'
            : e?.name === 'NotFoundError' ? 'لا توجد كاميرا على هذا الجهاز' : 'تعذّر تشغيل الكاميرا';
        setMsg(m);
        onError?.(m);
      }
    })();
    return stop;
  }, []); // eslint-disable-line

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl bg-[#0b1413]">
      <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />
      {state === 'scanning' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="relative h-[62%] w-[62%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(11,20,19,.45)]">
            <div className="qr-scanline absolute inset-x-3 h-0.5 rounded bg-brand-300" />
          </div>
        </div>
      )}
      {state !== 'scanning' && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] font-bold text-white/85">
          {state === 'starting' ? 'جارٍ تشغيل الكاميرا…' : msg}
        </div>
      )}
    </div>
  );
}
