import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';

/**
 * Countdown clock driven by authoritative server values.
 *
 * Implementation note: the displayed time is *derived* from a timestamp anchor
 * (`{ ms, t, running }`) on every render — never accumulated into React state.
 * This makes the clock immune to dropped frames, browser tab throttling, slow
 * renders, parent re-renders, and React batching: the displayed value is always
 * `anchor.ms - (perf.now() - anchor.t)` while running, computed fresh.
 *
 * The anchor is re-snapshotted in two situations:
 *   1. `serverMs` changes — a fresh authoritative value arrived from the server.
 *   2. `active` flips — capture the currently displayed value so the clock
 *      freezes (or unfreezes) cleanly even if no new `serverMs` accompanies the
 *      flip (e.g. game ends mid-think).
 *
 * `requestAnimationFrame` is used only to trigger re-renders for smooth display
 * — it never mutates state, so missed frames cannot cause drift.
 */
export function Clock({ serverMs, active, label }) {
  const anchorRef = useRef({ ms: serverMs, t: performance.now(), running: active });
  // useReducer's dispatch is guaranteed stable by React, so the rAF and layout
  // effects can close over `rerender` safely without dependency-list churn.
  const [, rerender] = useReducer((n) => (n + 1) | 0, 0);

  // Re-anchor on every authoritative server update. Layout-effect so the
  // synchronous rerender() below commits before paint — `serverMs` and `active`
  // typically change in the same render (both come from gameState in App.jsx),
  // and a passive useEffect here would briefly paint the previous anchor first.
  useLayoutEffect(() => {
    anchorRef.current = { ms: serverMs, t: performance.now(), running: active };
    rerender();
    // `active` is intentionally read but not a dep — the active-flip effect
    // below handles transitions independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMs]);

  // Re-anchor on every active flip — bake the currently displayed value into
  // the anchor so freeze/unfreeze is seamless. Layout-effect for the same
  // pre-paint reason as above.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const elapsed = a.running ? performance.now() - a.t : 0;
    anchorRef.current = {
      ms: Math.max(0, a.ms - elapsed),
      t: performance.now(),
      running: active,
    };
    rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // While running, schedule re-renders for smooth display. The value itself is
  // always derived from the anchor — this loop only paints. Stop scheduling
  // once the clock is exhausted: the displayed value is already clamped to 0
  // and continuing to repaint would just burn CPU/battery until the server's
  // game_over message arrives and flips `active` false.
  useEffect(() => {
    if (!active) return;
    let raf;
    const loop = () => {
      const a = anchorRef.current;
      const remaining = Math.max(0, a.ms - (a.running ? performance.now() - a.t : 0));
      rerender();
      if (a.running && remaining > 0) {
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // Derive the displayed value freshly from the anchor.
  const a = anchorRef.current;
  const elapsed = a.running ? performance.now() - a.t : 0;
  const displayMs = Math.max(0, a.ms - elapsed);

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
