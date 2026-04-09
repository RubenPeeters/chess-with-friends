import { ECO } from './eco.js';

/**
 * Given an array of SAN move strings (e.g. ['e4','c5','Nf3',...]),
 * returns the most specific matching ECO opening, or null.
 *
 * Duplicated from frontend/src/utils/openings.js — the ECO dataset is
 * small (~200 entries) so a shared package would add build complexity
 * for minimal gain.
 */
export function identifyOpening(sanMoves) {
  if (!sanMoves || sanMoves.length === 0) return null;

  const gameStr = sanMoves.join(' ');
  let best = null;
  let bestLen = 0;

  for (const entry of ECO) {
    if (!entry.moves) continue;
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
