import { useEffect, useRef, useState } from 'react';

/**
 * Countdown clock driven by authoritative server values.
 * Local rAF tick runs between state_update messages for smooth display.
 */
export function Clock({ serverMs, active, label }) {
  const [displayMs, setDisplayMs] = useState(serverMs);
  const rafRef = useRef(null);
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
        const elapsed = now - lastTickRef.current;
        setDisplayMs((prev) => Math.max(0, prev - elapsed));
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
    <div style={css.wrapper(active, isLow)}>
      <span style={css.label}>{label}</span>
      <span style={css.time(active, isLow)}>{timeStr}</span>
    </div>
  );
}

const css = {
  wrapper: (active, isLow) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
    padding: '0.75rem 1.25rem',
    borderRadius: 'var(--radius-md)',
    background: active ? 'var(--surface-lowest)' : 'var(--surface-low)',
    boxShadow: active ? 'var(--ambient-shadow-raised)' : 'none',
    minWidth: 120,
    transition: 'background 0.25s, box-shadow 0.25s',
    // Ghost border only when active + low time (accessibility signal)
    outline: isLow && active ? '1.5px solid rgba(185, 28, 28, 0.25)' : 'none',
  }),
  label: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--on-surface-muted)',
  },
  time: (active, isLow) => ({
    fontFamily: 'var(--font-mono)',
    fontSize: '1.75rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
    color: isLow && active ? '#b91c1c' : active ? 'var(--primary)' : 'var(--on-surface)',
    transition: 'color 0.25s',
  }),
};
