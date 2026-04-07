import { useEffect, useRef, useState } from 'react';

/**
 * Countdown clock driven by authoritative server values.
 * Local rAF tick runs between state_update messages for smooth display.
 */
export function Clock({ serverMs, active, label }) {
  const [displayMs, setDisplayMs] = useState(serverMs);
  const rafRef      = useRef(null);
  const lastTickRef = useRef(null);

  useEffect(() => {
    setDisplayMs(serverMs);
    lastTickRef.current = null;
  }, [serverMs]);

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = (now) => {
      if (lastTickRef.current !== null) {
        setDisplayMs((prev) => Math.max(0, prev - (now - lastTickRef.current)));
      }
      lastTickRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
    };
  }, [active]);

  const minutes = Math.floor(displayMs / 60_000);
  const seconds = Math.floor((displayMs % 60_000) / 1000);
  const tenths  = Math.floor((displayMs % 1_000) / 100);
  const isLow   = displayMs < 30_000;

  const timeStr = displayMs < 20_000
    ? `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className={[
      'flex flex-col gap-0.5 px-4 py-3 rounded-2xl min-w-[120px] transition-all duration-300',
      active
        ? 'bg-white border border-surface-high shadow-[0_2px_12px_rgba(0,0,0,0.08)]'
        : 'bg-surface-low border border-transparent',
      active && isLow ? 'border-danger/30' : '',
    ].join(' ')}>
      <span className="font-body text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
        {label}
      </span>
      <span className={[
        'font-mono text-[1.75rem] font-bold nums-tabular tracking-[-0.03em] transition-colors duration-300 leading-tight',
        active && isLow ? 'text-danger' : active ? 'text-primary' : 'text-on-surface/60',
      ].join(' ')}>
        {timeStr}
      </span>
    </div>
  );
}
