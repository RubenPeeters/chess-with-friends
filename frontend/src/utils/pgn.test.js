import { describe, it, expect } from 'vitest';
import { parsePgn } from './pgn.js';

// ── Valid PGNs — happy paths ─────────────────────────────────────────────────

const MINIMAL_PGN = `[Event "Casual game"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[TimeControl "5+0"]

1. e4 e5 2. Nf3 Nc6 1-0`;

describe('parsePgn — valid input', () => {
  it('returns game metadata and moves for a simple PGN', () => {
    const data = parsePgn(MINIMAL_PGN);
    expect(data.game.white_name).toBe('Alice');
    expect(data.game.black_name).toBe('Bob');
    expect(data.game.time_control).toBe('5+0');
    expect(data.game.result).toBe('white');
    expect(data.moves).toHaveLength(4);
    expect(data.moves[0].san).toBe('e4');
    expect(data.moves[1].san).toBe('e5');
    expect(data.moves[2].san).toBe('Nf3');
    expect(data.moves[3].san).toBe('Nc6');
  });

  it('captures a FEN for every move', () => {
    const data = parsePgn(MINIMAL_PGN);
    for (const m of data.moves) {
      expect(typeof m.fen).toBe('string');
      expect(m.fen.length).toBeGreaterThan(20);
    }
  });

  it('maps "0-1" to black winning', () => {
    const pgn = `[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1`;
    expect(parsePgn(pgn).game.result).toBe('black');
  });

  it('maps "1/2-1/2" to draw', () => {
    const pgn = `[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nf6 1/2-1/2`;
    expect(parsePgn(pgn).game.result).toBe('draw');
  });

  it('maps "*" (game in progress / unknown) to null', () => {
    const pgn = `[Result "*"]\n\n1. e4 e5 *`;
    expect(parsePgn(pgn).game.result).toBeNull();
  });

  it('handles PGN with no headers gracefully', () => {
    // chess.js populates '?' for missing headers rather than leaving them
    // undefined, so parsePgn's `?? 'White'` fallback doesn't kick in — but
    // the result must still be strings, not crash, and still produce moves.
    const data = parsePgn(`1. e4 e5 2. Nf3 *`);
    expect(typeof data.game.white_name).toBe('string');
    expect(typeof data.game.black_name).toBe('string');
    expect(typeof data.game.time_control).toBe('string');
    expect(data.game.result).toBeNull();
    expect(data.moves.length).toBe(3);
  });

  it('parses castling correctly', () => {
    const pgn = `1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. O-O Nf6 *`;
    const data = parsePgn(pgn);
    expect(data.moves.map((m) => m.san)).toContain('O-O');
  });

  it('parses checks and captures without error', () => {
    // Scholar's mate — a short legal game with captures and a checkmate.
    const pgn = `1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`;
    const data = parsePgn(pgn);
    expect(data.moves).toHaveLength(7);
    expect(data.moves[6].san).toContain('#');
    expect(data.game.result).toBe('white');
  });
});

// ── Invalid PGNs — error paths ───────────────────────────────────────────────

describe('parsePgn — invalid input', () => {
  it('throws on empty string', () => {
    expect(() => parsePgn('')).toThrow(/empty/i);
  });

  it('throws on whitespace-only input', () => {
    expect(() => parsePgn('   \n\t  ')).toThrow(/empty/i);
  });

  it('throws on null input', () => {
    expect(() => parsePgn(null)).toThrow(/empty/i);
  });

  it('throws on PGN with headers but no moves', () => {
    const pgn = `[White "A"]\n[Black "B"]\n[Result "*"]\n\n*`;
    expect(() => parsePgn(pgn)).toThrow(/no moves/i);
  });

  it('throws on a move sequence that chess.js rejects', () => {
    // Nf6 before the knight can legally move
    const pgn = `1. Nf6 *`;
    expect(() => parsePgn(pgn)).toThrow(/Invalid PGN/i);
  });
});
