import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeGlicko2 } from './glicko2.js';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const DEFAULT = { rating: 1200, rd: 350, volatility: 0.06 };

function equal() {
  return { rating: 1500, rd: 200, volatility: 0.06 };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('computeGlicko2', () => {

  describe('win / loss / draw', () => {
    it('increases the winner\'s rating', () => {
      const { white } = computeGlicko2({
        winner: 'white',
        white: { ...equal() },
        black: { ...equal() },
      });
      assert.ok(white.rating > 1500, `expected ${white.rating} > 1500`);
    });

    it('decreases the loser\'s rating', () => {
      const { black } = computeGlicko2({
        winner: 'white',
        white: { ...equal() },
        black: { ...equal() },
      });
      assert.ok(black.rating < 1500, `expected ${black.rating} < 1500`);
    });

    it('a draw against an equal opponent keeps ratings roughly the same', () => {
      const { white, black } = computeGlicko2({
        winner: 'draw',
        white: { ...equal() },
        black: { ...equal() },
      });
      // Ratings should barely change (<5 points) since it's equal
      assert.ok(Math.abs(white.rating - 1500) < 5);
      assert.ok(Math.abs(black.rating - 1500) < 5);
    });
  });

  describe('rating deviation', () => {
    it('RD decreases after a game (certainty increases)', () => {
      const before = { ...equal() };
      const { white } = computeGlicko2({
        winner: 'white',
        white: before,
        black: { ...equal() },
      });
      assert.ok(white.rd < before.rd, `expected ${white.rd} < ${before.rd}`);
    });
  });

  describe('asymmetry', () => {
    it('beating a much higher-rated opponent gives a bigger boost', () => {
      const { white: bigUpset } = computeGlicko2({
        winner: 'white',
        white: { rating: 1200, rd: 200, volatility: 0.06 },
        black: { rating: 1800, rd: 200, volatility: 0.06 },
      });
      const { white: normal } = computeGlicko2({
        winner: 'white',
        white: { rating: 1200, rd: 200, volatility: 0.06 },
        black: { rating: 1200, rd: 200, volatility: 0.06 },
      });
      assert.ok(
        bigUpset.rating - 1200 > normal.rating - 1200,
        `upset gain (${bigUpset.rating - 1200}) should exceed normal gain (${normal.rating - 1200})`
      );
    });

    it('a draw against a much lower-rated opponent lowers your rating', () => {
      const { white } = computeGlicko2({
        winner: 'draw',
        white: { rating: 1800, rd: 200, volatility: 0.06 },
        black: { rating: 1200, rd: 200, volatility: 0.06 },
      });
      assert.ok(white.rating < 1800, `expected ${white.rating} < 1800`);
    });
  });

  describe('output shape', () => {
    it('returns rating, rd, volatility for both players', () => {
      const result = computeGlicko2({
        winner: 'white',
        white: { ...DEFAULT },
        black: { ...DEFAULT },
      });
      for (const side of ['white', 'black']) {
        assert.equal(typeof result[side].rating, 'number');
        assert.equal(typeof result[side].rd, 'number');
        assert.equal(typeof result[side].volatility, 'number');
        assert.ok(result[side].rating > 0);
        assert.ok(result[side].rd > 0);
        assert.ok(result[side].volatility > 0);
      }
    });

    it('handles string inputs (coerces to number)', () => {
      // The DB returns NUMERIC columns as strings; computeGlicko2 should
      // Number() them internally.
      const result = computeGlicko2({
        winner: 'white',
        white: { rating: '1200', rd: '350', volatility: '0.06' },
        black: { rating: '1200', rd: '350', volatility: '0.06' },
      });
      assert.ok(result.white.rating > 1200);
    });
  });
});
