import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * الوضع الفاتح/الداكن. الاختيار محفوظ في المتصفح: light | dark | system (يتبع الجهاز).
 * الصنف `dark` يُضاف لـ <html> مبكراً في index.html لتجنّب وميض الأبيض عند الفتح.
 */
const KEY = 'clinic.theme';
const Ctx = createContext({ mode: 'system', dark: false, setMode: () => {}, toggle: () => {} });
export const useTheme = () => useContext(Ctx);

const systemDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const readMode = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };

function apply(dark, animate) {
  const el = document.documentElement;
  if (animate) {
    el.classList.add('theme-anim');
    setTimeout(() => el.classList.remove('theme-anim'), 320);
  }
  el.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1413' : '#0f6360');
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readMode);
  const [sys, setSys] = useState(systemDark);
  const dark = mode === 'dark' || (mode === 'system' && sys);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const on = (e) => setSys(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const first = React.useRef(true);
  useEffect(() => { apply(dark, !first.current); first.current = false; }, [dark]);

  const setMode = useCallback((m) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* وضع التصفح الخاص */ }
  }, []);
  const toggle = useCallback(() => setMode(dark ? 'light' : 'dark'), [dark, setMode]);

  const value = useMemo(() => ({ mode, dark, setMode, toggle }), [mode, dark, setMode, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** ألوان الرسوم البيانية حسب الوضع (Recharts يحتاج ألواناً صريحة لا أصناف Tailwind) */
export function useChartTheme() {
  const { dark } = useTheme();
  return useMemo(() => (dark ? {
    dark,
    axis: '#e2ecea', grid: '#283a38', cursor: 'rgba(67,183,174,.12)', stroke: '#13201f', ref: '#e2ecea',
    teal: '#3cc2b6', tealDeep: '#7fd9cf', mint: '#2a8f87', sun: '#e7b54a', clay: '#e58a74', leaf: '#86c96d', ink: '#e2ecea',
    series: ['#3cc2b6', '#e7b54a', '#e58a74', '#86c96d', '#9f8be8', '#6fb3e8', '#e88bb9', '#c9c46a'],
  } : {
    dark,
    axis: '#1c2b2a', grid: '#e6e1d8', cursor: '#effaf8', stroke: '#ffffff', ref: '#1c2b2a',
    teal: '#229a92', tealDeep: '#0f6360', mint: '#78d2ca', sun: '#d69a19', clay: '#c9604a', leaf: '#5aa843', ink: '#1c2b2a',
    series: ['#229a92', '#d69a19', '#c9604a', '#5aa843', '#7b61c9', '#3a86c8', '#c85a93', '#9a9431'],
  }), [dark]);
}

/** زر تبديل الوضع (للرأس) */
export function ThemeToggle({ className = '' }) {
  const { dark, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} className={`btn-ghost btn-sm !px-2.5 ${className}`}
      title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'} aria-label={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}>
      {dark ? (
        <svg viewBox="0 0 24 24" className="h-[1.15em] w-[1.15em]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[1.15em] w-[1.15em]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
      )}
    </button>
  );
}
