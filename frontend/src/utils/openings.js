import { ECO } from '../data/eco.js';

/**
 * Given an array of SAN move strings (e.g. ['e4','c5','Nf3',...]),
 * returns the most specific matching ECO opening, or null.
 */
export function identifyOpening(sanMoves) {
  if (!sanMoves || sanMoves.length === 0) return null;

  const gameStr = sanMoves.join(' ');
  let best = null;
  let bestLen = 0;

  for (const entry of ECO) {
    if (!entry.moves) continue;
    // Must match at a move boundary: entry.moves === gameStr  OR  gameStr starts with "entry.moves "
    const isMatch =
      gameStr === entry.moves ||
      gameStr.startsWith(entry.moves + ' ');

    if (isMatch && entry.moves.length > bestLen) {
      best = entry;
      bestLen = entry.moves.length;
    }
  }

  return best ? { eco: best.eco, name: best.name } : null;
}
