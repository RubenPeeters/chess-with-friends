/**
 * Glicko-2 rating system implementation.
 *
 * Reference: http://www.glicko.net/glicko/glicko2.pdf (Mark Glickman, 2012)
 *
 * Key constants:
 *   τ (tau)  = 0.5   — system constant, constrains volatility change
 *   SCALE    = 173.7178 — converts between Glicko and Glicko-2 scales
 *   BASE     = 1500  — Glicko-2 scale centre
 */

const TAU = 0.5;
const SCALE = 173.7178;
const BASE = 1500;
const EPSILON = 1e-6; // Illinois algorithm convergence threshold

// ── Scale helpers ─────────────────────────────────────────────────────────────

function toGlicko2(rating, rd) {
  return { mu: (rating - BASE) / SCALE, phi: rd / SCALE };
}

function fromGlicko2(mu, phi) {
  return { rating: SCALE * mu + BASE, rd: SCALE * phi };
}

// ── Glicko-2 functions ────────────────────────────────────────────────────────

/** g(φ) — impact function that reduces effect of uncertain opponents */
function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(μ, μj, φj) — expected score for player μ against opponent (μj, φj) */
function E(mu, muJ, phiJ) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

// ── Volatility update (Illinois algorithm) ────────────────────────────────────

/**
 * Find the new volatility σ' using the Illinois bisection variant.
 * Illinois converges faster than plain regula falsi by halving f(A) when
 * the new point falls on the same side as C.
 */
function newVolatility(sigma, phi, v, delta) {
  const a = Math.log(sigma * sigma);

  function f(x) {
    const ex = Math.exp(x);
    const d2 = delta * delta;
    const p2 = phi * phi;
    return (
      (ex * (d2 - p2 - v - ex)) / (2 * Math.pow(p2 + v + ex, 2)) -
      (x - a) / (TAU * TAU)
    );
  }

  // Initial bracket [A, B]
  let A = a;
  let B =
    delta * delta > phi * phi + v
      ? Math.log(delta * delta - phi * phi - v)
      : (() => {
          let k = 1;
          while (f(a - k * TAU) < 0) k++;
          return a - k * TAU;
        })();

  let fA = f(A);
  let fB = f(B);

  // Illinois iteration
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2; // Illinois step — shrink fA to avoid bias
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

// ── Single-player update ──────────────────────────────────────────────────────

function updatePlayer(player, opponent, score) {
  const { mu, phi } = toGlicko2(Number(player.rating), Number(player.rd));
  const { mu: muJ, phi: phiJ } = toGlicko2(
    Number(opponent.rating),
    Number(opponent.rd)
  );
  const sigma = Number(player.volatility);

  const gJ = g(phiJ);
  const eJ = E(mu, muJ, phiJ);

  // Estimated variance of player's performance
  const v = 1 / (gJ * gJ * eJ * (1 - eJ));

  // Estimated improvement over expected performance
  const delta = v * gJ * (score - eJ);

  // Step 5: new volatility
  const sigmaPrime = newVolatility(sigma, phi, v, delta);

  // Step 6: new phi* (inflated deviation for the rating period)
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);

  // Step 7: new phi' and mu'
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * gJ * (score - eJ);

  const { rating, rd } = fromGlicko2(muPrime, phiPrime);
  return {
    rating: Math.round(rating * 100) / 100,
    rd: Math.round(rd * 100) / 100,
    volatility: Math.round(sigmaPrime * 100000) / 100000,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute updated Glicko-2 ratings for both players after a game.
 *
 * @param {{
 *   winner: 'white' | 'black' | 'draw',
 *   white: { rating: number, rd: number, volatility: number },
 *   black: { rating: number, rd: number, volatility: number },
 * }}
 * @returns {{ white: { rating, rd, volatility }, black: { rating, rd, volatility } }}
 */
export function computeGlicko2({ winner, white, black }) {
  const whiteScore = winner === 'white' ? 1 : winner === 'draw' ? 0.5 : 0;
  const blackScore = 1 - whiteScore;

  return {
    white: updatePlayer(white, black, whiteScore),
    black: updatePlayer(black, white, blackScore),
  };
}
