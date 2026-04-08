import { Chess } from 'chess.js';

/**
 * PGN `[Result "..."]` tag → the `result` shape used by GameReview / the
 * social /history endpoint. `*` (game in progress) and unknown values map to
 * null so the UI shows no badge.
 */
const RESULT_MAP = {
  '1-0':     'white',
  '0-1':     'black',
  '1/2-1/2': 'draw',
};

/**
 * Parse a PGN string into the same data shape that the social `/history/:id`
 * endpoint returns, so the GameReview component can render it without caring
 * about the data source.
 *
 * Throws an Error with a friendly message on invalid input — callers should
 * surface `err.message` to the user verbatim.
 *
 * @param {string} pgn
 * @returns {{
 *   game: {
 *     white_name: string,
 *     black_name: string,
 *     time_control: string,
 *     result: 'white' | 'black' | 'draw' | null,
 *   },
 *   moves: { san: string, fen: string }[],
 * }}
 */
export function parsePgn(pgn) {
  if (!pgn || !pgn.trim()) {
    throw new Error('PGN is empty');
  }

  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (err) {
    throw new Error(`Invalid PGN: ${err.message}`);
  }

  const headers = chess.header();
  const verbose = chess.history({ verbose: true });

  if (verbose.length === 0) {
    throw new Error('PGN contains no moves');
  }

  // chess.js's verbose history doesn't include the FEN after each move, so
  // replay the moves on a fresh instance to capture them. This matches the
  // shape produced by the social /history endpoint, where `moves[i].fen` is
  // the position *after* move i.
  const replay = new Chess();
  const moves = verbose.map((m) => {
    replay.move({ from: m.from, to: m.to, promotion: m.promotion });
    return { san: m.san, fen: replay.fen() };
  });

  return {
    game: {
      white_name:   headers.White       ?? 'White',
      black_name:   headers.Black       ?? 'Black',
      time_control: headers.TimeControl ?? '?',
      result:       RESULT_MAP[headers.Result] ?? null,
    },
    moves,
  };
}
