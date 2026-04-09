const BAR_WIDTH = 28;

/**
 * Vertical evaluation bar — white at the bottom, black at the top.
 * Eval is always from white's perspective (positive = white better).
 * The numeric eval label is fixed at the vertical center of the bar;
 * the black/white split animates behind it. Text color adapts for
 * contrast based on which half currently covers the center.
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

  // Label sits at the fixed vertical center (50%) of the bar — it never
  // moves, only the split behind it shifts. Text color adapts to whichever
  // half currently covers the center: dark (black) half is topPct% tall, so
  // when topPct > 50 the center is inside the dark zone.
  const labelOnDark = topPct > 50;

  return (
    <div className="select-none h-full" style={{ width: BAR_WIDTH }}>
      {/* Bar — owns the full stretched height. Depth badge and eval label
          are absolutely positioned inside so they don't eat into the bar's
          height (which must match the board exactly). */}
      <div className="relative w-full h-full rounded-sm overflow-hidden flex flex-col border border-black/10">
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
        {/* Depth indicator — absolutely positioned at the top so it doesn't
            reduce the bar's height */}
        {evaluation?.depth && (
          <span className="absolute top-1 left-1/2 -translate-x-1/2 font-mono text-[0.5rem] text-white/50 leading-none pointer-events-none z-10">
            d{evaluation.depth}
          </span>
        )}
        {/* Eval label — fixed at the vertical center of the bar */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
          <span className={[
            'font-mono text-[0.55rem] font-semibold leading-none',
            labelOnDark ? 'text-white/70' : 'text-black/50',
          ].join(' ')}>
            {evalText}
          </span>
        </div>
      </div>
    </div>
  );
}
