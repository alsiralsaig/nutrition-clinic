/**
 * استشارة مرئية بين الأخصائي والمريض — WebRTC مباشر بين المتصفحين (الصوت والصورة لا يمرّان بالخادم).
 * الخادم ينقل فقط رسائل الإعداد (SDP) عبر الاستطلاع لأن Vercel لا يدعم WebSocket.
 *
 * البروتوكول: كل طرف يرسل hello عند الانضمام. الأخصائي هو من يبدأ العرض (offer) دائماً:
 *  - الأخصائي يستلم hello من المريض → اتصال جديد + offer
 *  - المريض يستلم hello من الأخصائي (أعاد التحميل) → يعيد ضبط اتصاله ويرد بـ hello
 *  - المريض يستلم offer → answer.  كل offer يحمل رقماً (n) لتجاهل الإجابات القديمة.
 * الوسائط: getUserMedia (كاميرا/ميكروفون) + getDisplayMedia (مشاركة الشاشة عبر replaceTrack بلا إعادة تفاوض).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const waitIce = (pc, ms = 2500) => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); }
  function check() { if (pc.iceGatheringState === 'complete') done(); }
  pc.addEventListener('icegatheringstatechange', check);
});

const fmtDur = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
export const mediaSupported = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined';

const Btn = ({ on = true, danger, onClick, title, children, disabled }) => (
  <button type="button" onClick={onClick} title={title} aria-label={title} disabled={disabled}
    className={`grid h-12 w-12 place-items-center rounded-full text-[20px] transition disabled:opacity-40 ${danger ? 'bg-[#d64545] text-white hover:bg-[#b93a3a]' : on ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-[#0b1413]'}`}>
    {children}
  </button>
);
const MicIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />{off && <path d="M4 4l16 16" />}</svg>
);
const CamIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="3" y="6.5" width="12.5" height="11" rx="2.5" /><path d="m15.5 10.5 5-3v9l-5-3" />{off && <path d="M3 4l17 16" />}</svg>
);
const ScreenIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M8.5 20h7M12 16.5V20M12 13V7.5M9.5 10 12 7.5 14.5 10" /></svg>
);
const FlipIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 8h11a4 4 0 0 1 4 4v1M8 4 4 8l4 4M20 16H9a4 4 0 0 1-4-4v-1M16 20l4-4-4-4" /></svg>
);
const EndIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[24px] w-[24px] rotate-[135deg]" fill="currentColor"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" /></svg>
);

/**
 * client: { pull(after) → {items,last_id,status,peer_online}, signal(kind,payload), end() }
 * role: 'doctor' | 'patient'
 */
export function VideoCall({ role, client, iceServers, title, subtitle, onClose, onEnded }) {
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);      // كاميرا + ميكروفون
  const screenRef = useRef(null);      // مسار مشاركة الشاشة
  const seqRef = useRef(0);
  const lastIdRef = useRef(0);
  const aliveRef = useRef(true);
  const connectedRef = useRef(false);
  const facingRef = useRef('user');

  const [phase, setPhase] = useState('media');   // media | waiting | connecting | connected | reconnecting | ended | error
  const [error, setError] = useState('');
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [hasRemote, setHasRemote] = useState(false);
  const [secs, setSecs] = useState(0);
  const [note, setNote] = useState('');

  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  const send = useCallback((kind, payload) => client.signal(kind, payload).catch(() => {}), [client]);

  const currentVideoTrack = () => screenRef.current || streamRef.current?.getVideoTracks()[0] || null;

  const resetPc = useCallback(() => {
    try { pcRef.current?.close(); } catch { /* */ }
    const pc = new RTCPeerConnection({ iceServers: iceServers?.length ? iceServers : [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;
    const s = streamRef.current;
    if (s) {
      s.getAudioTracks().forEach((t) => pc.addTrack(t, s));
      const v = currentVideoTrack();
      if (v) pc.addTrack(v, s);
    }
    pc.ontrack = (e) => {
      if (remoteRef.current && e.streams[0]) { remoteRef.current.srcObject = e.streams[0]; setHasRemote(true); }
    };
    pc.onicecandidate = (e) => {
      // الإعداد الأساسي يُرسل بعد اكتمال جمع المرشحين؛ المتأخرون يُرسلون فرادى
      if (e.candidate && pc.__sentSdp) send('ice', { candidate: e.candidate.toJSON(), n: pc.__n });
    };
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') { connectedRef.current = true; setPhase('connected'); send('state', { connected: true }); }
      else if (st === 'disconnected') setPhase('reconnecting');
      else if (st === 'failed') {
        connectedRef.current = false;
        setPhase('reconnecting');
        if (role === 'doctor') setTimeout(() => aliveRef.current && makeOffer(), 800); // eslint-disable-line no-use-before-define
      }
    };
    return pc;
  }, [iceServers, role, send]); // eslint-disable-line

  const makeOffer = useCallback(async () => {
    const pc = resetPc();
    const n = ++seqRef.current;
    pc.__n = n;
    setPhase((p) => (p === 'connected' ? 'reconnecting' : 'connecting'));
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    if (pcRef.current !== pc) return;
    pc.__sentSdp = true;
    await send('offer', { type: 'offer', sdp: pc.localDescription.sdp, n });
  }, [resetPc, send]);

  const handle = useCallback(async (s) => {
    const pc = pcRef.current;
    if (s.kind === 'hello') {
      if (role === 'doctor') await makeOffer();
      else { resetPc(); setHasRemote(false); setPhase('connecting'); await send('hello'); }
    } else if (s.kind === 'offer' && role === 'patient') {
      const p2 = resetPc();
      p2.__n = s.payload?.n;
      setPhase('connecting');
      await p2.setRemoteDescription({ type: 'offer', sdp: s.payload.sdp });
      const ans = await p2.createAnswer();
      await p2.setLocalDescription(ans);
      await waitIce(p2);
      if (pcRef.current !== p2) return;
      p2.__sentSdp = true;
      await send('answer', { type: 'answer', sdp: p2.localDescription.sdp, n: s.payload?.n });
    } else if (s.kind === 'answer' && role === 'doctor') {
      if (pc && s.payload?.n === seqRef.current && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: s.payload.sdp });
      }
    } else if (s.kind === 'ice') {
      if (pc && pc.remoteDescription && s.payload?.n === pc.__n) { try { await pc.addIceCandidate(s.payload.candidate); } catch { /* */ } }
    } else if (s.kind === 'bye') {
      setHasRemote(false);
      connectedRef.current = false;
      if (remoteRef.current) remoteRef.current.srcObject = null;
      if (role === 'patient') { setPhase('ended'); } else { setPhase('waiting'); try { pcRef.current?.close(); } catch { /* */ } }
    }
  }, [role, makeOffer, resetPc, send]);

  // الوسائط + الانضمام + حلقة الاستطلاع
  useEffect(() => {
    aliveRef.current = true;
    let timer = 0;
    (async () => {
      try {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (e) {
          if (e?.name === 'NotAllowedError') throw e;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); // بلا كاميرا: صوت فقط
          setCam(false);
        }
        if (!aliveRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (localRef.current) localRef.current.srcObject = stream;
        const first = await client.pull(-1);
        lastIdRef.current = first.last_id;
        setPeerOnline(!!first.peer_online);
        if (first.status === 'ended') { setPhase('ended'); return; }
        setPhase('waiting');
        await send('hello');
        const loop = async () => {
          if (!aliveRef.current) return;
          try {
            const r = await client.pull(lastIdRef.current);
            setPeerOnline(!!r.peer_online);
            for (const s of r.items) { lastIdRef.current = Math.max(lastIdRef.current, s.id); await handle(s); } // eslint-disable-line no-await-in-loop
            if (r.items.length === 0) lastIdRef.current = Math.max(lastIdRef.current, r.last_id);
            if (r.status === 'ended') { setPhase('ended'); return; }
          } catch (e) {
            if (e?.status === 404 || e?.status === 401) { setPhase('ended'); return; }
          }
          // أسرع أثناء الإعداد، أبطأ بعد الاتصال (توفير استدعاءات الخادم)
          timer = setTimeout(loop, connectedRef.current ? 3000 : 1000);
        };
        loop();
      } catch (e) {
        setError(e?.name === 'NotAllowedError' ? 'اسمح للمتصفح باستخدام الكاميرا والميكروفون ثم أعد المحاولة'
          : !mediaSupported() ? 'المتصفح لا يدعم المكالمات المرئية أو الاتصال غير آمن (https)' : (e?.message || 'تعذّر تشغيل الكاميرا/الميكروفون'));
        setPhase('error');
      }
    })();
    return () => {
      aliveRef.current = false;
      clearTimeout(timer);
      try { pcRef.current?.close(); } catch { /* */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenRef.current?.stop();
    };
  }, []); // eslint-disable-line

  // عدّاد المدة
  useEffect(() => {
    if (phase !== 'connected') return undefined;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => { if (phase === 'ended') onEnded?.(); }, [phase]); // eslint-disable-line

  const toggleMic = () => { const on = !mic; streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = on; }); setMic(on); };
  const toggleCam = () => { const on = !cam; streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = on; }); setCam(on); };

  const replaceVideo = async (track) => {
    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video' || (!s.track && s.__video));
    if (sender) await sender.replaceTrack(track);
  };
  const stopShare = async () => {
    const cameraTrack = streamRef.current?.getVideoTracks()[0] || null;
    screenRef.current?.stop();
    screenRef.current = null;
    setSharing(false);
    await replaceVideo(cameraTrack);
    if (localRef.current) localRef.current.srcObject = streamRef.current;
  };
  const share = async () => {
    if (sharing) return stopShare();
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const track = ds.getVideoTracks()[0];
      screenRef.current = track;
      track.onended = () => stopShare();
      if (!pcRef.current?.getSenders().some((s) => s.track?.kind === 'video')) {
        // مكالمة بدأت بلا كاميرا: نضيف المسار ونعيد التفاوض (الأخصائي فقط يبدأ العروض)
        if (role === 'doctor') await makeOffer(); else await send('hello');
      } else await replaceVideo(track);
      if (localRef.current) localRef.current.srcObject = new MediaStream([track]);
      setSharing(true);
    } catch { /* ألغى المستخدم نافذة الاختيار */ }
  };
  const flip = async () => {
    try {
      facingRef.current = facingRef.current === 'user' ? 'environment' : 'user';
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingRef.current }, audio: false });
      const nt = s.getVideoTracks()[0];
      const old = streamRef.current.getVideoTracks()[0];
      if (old) { streamRef.current.removeTrack(old); old.stop(); }
      streamRef.current.addTrack(nt);
      nt.enabled = cam;
      if (!sharing) { await replaceVideo(nt); if (localRef.current) localRef.current.srcObject = streamRef.current; }
    } catch { /* جهاز بكاميرا واحدة */ }
  };
  const hangup = async () => {
    aliveRef.current = false;
    try { await client.end(); } catch { /* */ }
    setPhase('ended');
    onClose?.();
  };

  const status = {
    media: 'جارٍ تشغيل الكاميرا والميكروفون…',
    waiting: role === 'doctor' ? (peerOnline ? 'المريض متصل — جارٍ الربط…' : 'بانتظار انضمام المريض من بوابته…') : (peerOnline ? 'الأخصائي متصل — جارٍ الربط…' : 'بانتظار الأخصائي… ابقَ على هذه الصفحة'),
    connecting: 'جارٍ الاتصال…',
    connected: 'متصل',
    reconnecting: 'انقطع الاتصال — جارٍ إعادة المحاولة…',
    ended: 'انتهت المكالمة',
    error: error,
  }[phase];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0b1413] text-white" data-video-call={phase} role="dialog" aria-label="مكالمة مرئية">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-extrabold">{title}</p>
          <p className="flex items-center gap-2 text-[12px] font-bold text-white/60">
            <span className={`inline-block h-2 w-2 rounded-full ${phase === 'connected' ? 'bg-[#5aa843]' : phase === 'error' || phase === 'ended' ? 'bg-[#d64545]' : 'animate-pulse bg-[#e7b54a]'}`} />
            {status}{phase === 'connected' && <span className="tnum" dir="ltr"> · {fmtDur(secs)}</span>}
            {subtitle && <span className="hidden sm:inline">· {subtitle}</span>}
          </p>
        </div>
        <button type="button" className="rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={phase === 'ended' || phase === 'error' ? onClose : hangup} aria-label="إغلاق"><Icon.close /></button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <video ref={remoteRef} autoPlay playsInline className={`h-full w-full bg-black object-contain ${hasRemote ? '' : 'invisible'}`} />
        {!hasRemote && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-white/10 text-[34px]">{phase === 'error' ? '⚠️' : phase === 'ended' ? '👋' : '🩺'}</div>
              <p className="text-[15px] font-bold text-white/85">{status}</p>
              {phase === 'error' && <button type="button" className="mt-4 rounded-xl bg-white px-4 py-2 text-[13px] font-extrabold text-[#0b1413]" onClick={() => window.location.reload()}>إعادة المحاولة</button>}
              {phase === 'waiting' && role === 'doctor' && <p className="mt-2 text-[12px] text-white/50">أرسل للمريض رابط الانضمام بواتساب إن لم يكن على البوابة</p>}
            </div>
          </div>
        )}
        <video ref={localRef} autoPlay playsInline muted
          className={`absolute bottom-3 end-3 w-28 rounded-xl border border-white/20 bg-black object-cover shadow-pop sm:w-44 ${sharing ? '' : '-scale-x-100'} ${cam || sharing ? '' : 'opacity-30'}`} style={{ aspectRatio: '3/4' }} />
        {role === 'doctor' && (
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="مذكرة سريعة أثناء الجلسة (تُنسخ عند الإنهاء)…"
            className="absolute start-3 top-3 hidden h-32 w-64 resize-none rounded-xl border border-white/15 bg-black/40 p-2.5 text-[12.5px] text-white placeholder:text-white/40 focus:outline-none lg:block" />
        )}
      </div>

      {phase !== 'ended' && phase !== 'error' && (
        <footer className="flex items-center justify-center gap-3 px-4 pb-6 pt-3">
          <Btn on={mic} onClick={toggleMic} title={mic ? 'كتم الميكروفون' : 'تشغيل الميكروفون'}><MicIcon off={!mic} /></Btn>
          <Btn on={cam} onClick={toggleCam} title={cam ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا'} disabled={!streamRef.current?.getVideoTracks().length}><CamIcon off={!cam} /></Btn>
          {canShare && <Btn on={!sharing} onClick={share} title={sharing ? 'إيقاف مشاركة الشاشة' : 'مشاركة الشاشة'}><ScreenIcon /></Btn>}
          <Btn onClick={flip} title="تبديل الكاميرا"><FlipIcon /></Btn>
          <Btn danger onClick={() => { if (note.trim()) navigator.clipboard?.writeText(note).catch(() => {}); hangup(); }} title={role === 'doctor' ? 'إنهاء المكالمة' : 'مغادرة'}><EndIcon /></Btn>
        </footer>
      )}
    </div>
  );
}
