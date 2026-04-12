import { describe, it, expect } from 'vitest';
import { identifyOpening } from './openings.js';

describe('identifyOpening', () => {
  it('returns null for an empty move list', () => {
    expect(identifyOpening([])).toBeNull();
  });

  it('returns null for null input', () => {
    expect(identifyOpening(null)).toBeNull();
  });

  it('returns null when nothing in the ECO book matches', () => {
    expect(identifyOpening(['h3', 'h6', 'h4'])).toBeNull();
  });

  it('returns null for a move that has no ECO entry on its own', () => {
    // The ECO dataset has no entry for bare "e4" — the shortest e-pawn
    // entries are two-move sequences (e.g. e4 e5, e4 c5). This verifies
    // the longest-prefix matcher correctly returns null instead of
    // matching a superset.
    expect(identifyOpening(['e4'])).toBeNull();
  });

  it('matches King\'s Pawn after 1.e4 e5', () => {
    const result = identifyOpening(['e4', 'e5']);
    expect(result).not.toBeNull();
    expect(result.eco).toBe('C20');
  });

  it('matches the Sicilian after 1.e4 c5', () => {
    const result = identifyOpening(['e4', 'c5']);
    expect(result).not.toBeNull();
    expect(result.name.toLowerCase()).toContain('sicilian');
  });

  it('prefers the longest matching prefix (Italian vs Ruy Lopez root)', () => {
    // After 1.e4 e5 2.Nf3 Nc6 3.Bb5 we should get Ruy Lopez, not just "e4 e5"
    const result = identifyOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(result).not.toBeNull();
    expect(result.name.toLowerCase()).toContain('ruy lopez');
  });

  it('matches the full prefix exactly (Najdorf)', () => {
    const moves = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'];
    const result = identifyOpening(moves);
    expect(result).not.toBeNull();
    expect(result.name.toLowerCase()).toContain('najdorf');
  });

  it('allows the game to continue past the matched prefix', () => {
    // After a Najdorf 6.Bg5 Nbd7 line, any further moves should still match
    // the B94 entry (longest prefix that's still a proper prefix of the game).
    const moves = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Bg5', 'Nbd7', 'Bc4'];
    const result = identifyOpening(moves);
    expect(result).not.toBeNull();
    expect(result.eco).toBe('B94');
  });

  it('does not false-match at a partial move boundary', () => {
    // Sanity: the entry 'e4 e5' (C20) should NOT match 'e4' alone. The
    // matcher uses exact equality OR trailing-space prefix — a SHORTER
    // move list should not accidentally match a longer entry.
    expect(identifyOpening(['e4'])).toBeNull();
    // And the reverse: a longer game should match its longest prefix entry,
    // not some superset it hasn't reached.
    const result = identifyOpening(['e4', 'e5']);
    expect(result).not.toBeNull();
    expect(result.eco).toBe('C20');
  });
});
