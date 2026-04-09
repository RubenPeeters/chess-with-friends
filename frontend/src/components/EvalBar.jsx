/**
 * Vertical evaluation bar — white at the bottom, black at the top.
 * Eval is always from white's perspective (positive = white better).
 * The numeric eval label floats at the dividing line between the two
 * halves, so it's centered when the position is equal and tracks the
 * split as the eval shifts.
 */
export function EvalBar({ evaluation, orientation = 'white' }) {
  // Map centipawns to white's share of the bar (0–100%).
  // Uses tanh so ±10 pawns → nearly 100/0%, ±2 pawns → ~80/20%.
  function whiteShare(ev) {
    if (!ev) return 50;
    if (ev.mate !== null) return ev.mate > 0 ? 99 : 1;
    const clamped = Math.max(-1200, Math.min(1200, ev.cp));
    return 50 + 50 * Math.tanh(clamped / 400);
  }

  const whitePct = whiteShare(evaluation);
  // When viewing as black, flip the bar
  const topPct   = orientation === 'white' ? 100 - whitePct : whitePct;
  const bottomPct = 100 - topPct;

  const evalText = (() => {
    if (!evaluation) return '0.0';
    if (evaluation.mate !== null) return `M${Math.abs(evaluation.mate)}`;
    const abs = Math.abs(evaluation.cp / 100);
    return abs >= 10 ? Math.round(abs).toString() : abs.toFixed(1);
  })();

  const whiteWinning = !evaluation
    || (evaluation.mate !== null ? evaluation.mate > 0 : evaluation.cp >= 0);

  // Clamp the label so it doesn't overflow the bar at extreme evals.
  const labelTop = Math.max(6, Math.min(94, topPct));

  return (
    <div className="flex flex-col items-center gap-1 select-none h-full" style={{ width: 28 }}>
      {/* Depth indicator */}
      {evaluation?.depth && (
        <span className="font-mono text-[0.5rem] text-muted leading-none">
          d{evaluation.depth}
        </span>
      )}

      {/* Bar — relative so the eval label can float at the split point */}
      <div className="relative flex-1 w-full rounded-sm overflow-hidden flex flex-col border border-black/10">
        {/* Top portion (black's side) */}
        <div
          className="bg-[#1c1c1c] transition-all duration-300 ease-out"
          style={{ height: `${topPct}%` }}
        />
        {/* Bottom portion (white's side) */}
        <div
          className="bg-[#f0f0f0] transition-all duration-300 ease-out"
          style={{ height: `${bottomPct}%` }}
        />
        {/* Eval label — centered at the split between black and white */}
        <div
          className="absolute inset-x-0 flex justify-center pointer-events-none transition-all duration-300 ease-out"
          style={{ top: `${labelTop}%`, transform: 'translateY(-50%)' }}
        >
          <span className={[
            'font-mono text-[0.55rem] font-semibold leading-none',
            whiteWinning ? 'text-black/50' : 'text-white/70',
          ].join(' ')}>
            {evalText}
          </span>
        </div>
      </div>
    </div>
  );
}
