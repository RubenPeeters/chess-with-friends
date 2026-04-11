import { Router } from 'express';
import { Chess } from 'chess.js';
import pool from '../db.js';
import { identifyOpening } from '../openings.js';

const router = Router();

const VALID_PLATFORMS = ['lichess', 'chesscom'];
const MAX_OPENING_HALF_MOVES = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Look up a linked account and verify ownership. Returns null for
 *  invalid UUIDs or non-matching rows (callers treat both as 404). */
async function getOwnedAccount(accountId, userId) {
  if (!UUID_RE.test(accountId)) return null;
  const { rows } = await pool.query(
    `SELECT * FROM linked_accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId]
  );
  return rows[0] ?? null;
}

/**
 * Parse a single PGN string into the shape we store in `external_games`.
 * Returns null if the PGN is unparseable or malformed. The entire body
 * is wrapped in a try/catch so one bad game can never abort a sync —
 * any unexpected throw from chess.js (bad headers, weird moves, replay
 * failures) falls through to `return null` and the caller counts it
 * as a skipped game.
 */
function parseGame(pgn, platform, linkedUsername) {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);

    const headers = chess.header();
    const verbose = chess.history({ verbose: true });
    if (verbose.length === 0) return null;

    // Replay to capture FEN after each move
    const replay = new Chess();
    const movesJson = verbose.map((m) => {
      replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      return { san: m.san, fen: replay.fen() };
    });

    const sanList = movesJson.map((m) => m.san);
    const openingSlice = sanList.slice(0, MAX_OPENING_HALF_MOVES);
    const openingMoves = openingSlice.join(' ');
    // Match against the same slice stored in `opening_moves` so the ECO
    // assignment is consistent with the data used for opening-tree queries.
    const opening = identifyOpening(openingSlice);

    const whiteName = headers.White ?? 'White';
    const blackName = headers.Black ?? 'Black';
    const lowerUser = linkedUsername.toLowerCase();
    const playerColor =
      whiteName.toLowerCase() === lowerUser ? 'white' :
      blackName.toLowerCase() === lowerUser ? 'black' : 'white';

    const resultMap = { '1-0': 'white', '0-1': 'black', '1/2-1/2': 'draw' };
    const result = resultMap[headers.Result] ?? null;

    // Derive a stable platform game ID
    let platformGameId;
    if (platform === 'lichess') {
      // Lichess Site header: "https://lichess.org/XXXXX"
      const siteMatch = (headers.Site ?? '').match(/lichess\.org\/(\w+)/);
      platformGameId = siteMatch ? siteMatch[1] : `${whiteName}-${blackName}-${headers.Date}-${headers.Round}`;
    } else {
      // Chess.com Link header or fallback
      const link = headers.Link ?? headers.Site ?? '';
      platformGameId = link || `${whiteName}-${blackName}-${headers.Date}-${headers.Round}`;
    }

    // PGN dates are sometimes "????.??.??" (unknown), which produces Invalid
    // Date. Fall back to null in that case — Postgres would reject an
    // invalid timestamp and abort the whole sync since we no longer swallow
    // insert errors.
    const parseDate = (s) => {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const playedAt = headers.UTCDate && headers.UTCTime
      ? parseDate(`${headers.UTCDate.replace(/\./g, '-')}T${headers.UTCTime}Z`)
      : headers.Date
        ? parseDate(headers.Date.replace(/\./g, '-'))
        : null;

    return {
      platformGameId,
      whiteName,
      blackName,
      playerColor,
      result,
      timeControl: headers.TimeControl ?? null,
      playedAt,
      pgn,
      movesJson,
      openingMoves,
      eco: opening?.eco ?? null,
      openingName: opening?.name ?? null,
    };
  } catch {
    return null;
  }
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;

/** fetch() with an AbortController timeout so a slow upstream can't hold an
 *  Express worker open indefinitely. */
async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLichessGames(username, max = 200) {
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}&pgnInJson=false`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/x-chess-pgn' },
  });
  if (!res.ok) {
    throw new Error(`Lichess API returned ${res.status}`);
  }
  const text = await res.text();
  // Split multi-game PGN by double newline followed by [Event
  return text.split(/\n\n(?=\[Event )/).filter((g) => g.trim());
}

async function fetchChesscomGames(username, months = 3) {
  const archiveRes = await fetchWithTimeout(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`
  );
  if (!archiveRes.ok) {
    throw new Error(`Chess.com API returned ${archiveRes.status}`);
  }
  const { archives = [] } = await archiveRes.json();
  // Fetch the most recent N months
  const recentArchives = archives.slice(-months);

  const pgns = [];
  for (const archiveUrl of recentArchives) {
    const monthRes = await fetchWithTimeout(archiveUrl);
    if (!monthRes.ok) continue;
    const { games = [] } = await monthRes.json();
    for (const game of games) {
      if (game.pgn) pgns.push(game.pgn);
    }
  }
  return pgns;
}

// ── POST /external/link ──────────────────────────────────────────────────────
router.post('/link', async (req, res) => {
  const { platform, username } = req.body;
  const trimmedUsername = (username ?? '').trim();

  if (!platform || !trimmedUsername) {
    return res.status(400).json({ error: 'platform and username are required' });
  }
  if (!VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
  }

  // Verify the username exists on the remote platform before creating
  // the linked account — avoids storing typos that would fail on sync.
  try {
    const checkUrl = platform === 'lichess'
      ? `https://lichess.org/api/user/${encodeURIComponent(trimmedUsername)}`
      : `https://api.chess.com/pub/player/${encodeURIComponent(trimmedUsername)}`;
    const checkRes = await fetchWithTimeout(checkUrl);
    if (checkRes.status === 404) {
      return res.status(422).json({ error: `Username "${trimmedUsername}" not found on ${platform}` });
    }
    if (!checkRes.ok) {
      return res.status(502).json({ error: `${platform} returned ${checkRes.status} while verifying username` });
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not verify username on ${platform}: ${err.message}` });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO linked_accounts (user_id, platform, username)
       VALUES ($1, $2, $3)
       RETURNING id, platform, username, linked_at, last_synced_at`,
      [req.user.id, platform, trimmedUsername]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `A ${platform} account is already linked` });
    }
    console.error('[external] link error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /external/accounts ───────────────────────────────────────────────────
router.get('/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, platform, username, linked_at, last_synced_at
       FROM linked_accounts
       WHERE user_id = $1
       ORDER BY linked_at`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[external] list accounts error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /external/accounts/:id ────────────────────────────────────────────
router.delete('/accounts/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid account id' });
  }
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM linked_accounts WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Linked account not found' });
    }
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[external] unlink error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /external/accounts/:id/sync — fetch + cache games ──────────────────
router.post('/accounts/:id/sync', async (req, res) => {
  try {
    const account = await getOwnedAccount(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'Linked account not found' });

    // Fetch PGNs from the external platform
    let rawPgns;
    try {
      rawPgns = account.platform === 'lichess'
        ? await fetchLichessGames(account.username)
        : await fetchChesscomGames(account.username);
    } catch (err) {
      console.error(`[external] fetch ${account.platform} error:`, err.message);
      return res.status(502).json({ error: `Failed to fetch games from ${account.platform}: ${err.message}` });
    }

    let imported = 0;
    let skipped = 0;

    for (const rawPgn of rawPgns) {
      const game = parseGame(rawPgn, account.platform, account.username);
      // Unparseable PGN is a legitimate skip — the sync should continue.
      if (!game) { skipped++; continue; }

      // Real DB errors (schema mismatch, connection issues, etc.) must
      // abort the sync — swallowing them would leave the caller thinking
      // the games were "skipped" (i.e. already imported) and mark the
      // account as synced, hiding data-loss bugs. The ON CONFLICT DO
      // NOTHING path handles expected duplicates without throwing.
      const { rowCount } = await pool.query(
        `INSERT INTO external_games
           (linked_account_id, platform, platform_game_id,
            white_name, black_name, player_color, result, time_control,
            played_at, pgn, moves_json, opening_moves, eco, opening_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (linked_account_id, platform_game_id) DO NOTHING`,
        [
          account.id, account.platform, game.platformGameId,
          game.whiteName, game.blackName, game.playerColor,
          game.result, game.timeControl,
          game.playedAt, game.pgn,
          JSON.stringify(game.movesJson), game.openingMoves,
          game.eco, game.openingName,
        ]
      );
      if (rowCount > 0) imported++;
      else skipped++;
    }

    // Update last_synced_at only after all inserts succeeded.
    await pool.query(
      `UPDATE linked_accounts SET last_synced_at = NOW() WHERE id = $1`,
      [account.id]
    );

    return res.json({ imported, skipped });
  } catch (err) {
    console.error('[external] sync error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /external/accounts/:id/games — paginated game list ───────────────────
router.get('/accounts/:id/games', async (req, res) => {
  try {
    const account = await getOwnedAccount(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'Linked account not found' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT id, white_name, black_name, player_color, result,
              time_control, played_at, eco, opening_name
       FROM external_games
       WHERE linked_account_id = $1
       ORDER BY played_at DESC NULLS LAST, id DESC
       LIMIT $2 OFFSET $3`,
      [account.id, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM external_games WHERE linked_account_id = $1`,
      [account.id]
    );

    return res.json({ games: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    console.error('[external] list games error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /external/games/:gameId — single game in GameReview shape ────────────
router.get('/games/:gameId', async (req, res) => {
  if (!UUID_RE.test(req.params.gameId)) {
    return res.status(400).json({ error: 'Invalid game id' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT eg.*, la.user_id
       FROM external_games eg
       JOIN linked_accounts la ON la.id = eg.linked_account_id
       WHERE eg.id = $1`,
      [req.params.gameId]
    );
    const game = rows[0];
    if (!game || game.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Return in the same shape GameReview expects (mirrors social /history/:id)
    return res.json({
      game: {
        white_name: game.white_name,
        black_name: game.black_name,
        time_control: game.time_control,
        result: game.result,
      },
      moves: game.moves_json,
    });
  } catch (err) {
    console.error('[external] get game error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /external/accounts/:id/openings — opening tree aggregation ───────────
router.get('/accounts/:id/openings', async (req, res) => {
  try {
    const account = await getOwnedAccount(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'Linked account not found' });

    // `moves` query param: space-separated SAN prefix, e.g. "e4 e5 Nf3".
    // Empty / omitted = root level (first-move stats).
    const rawMoves = req.query.moves;
    if (rawMoves != null && typeof rawMoves !== 'string') {
      return res.status(400).json({ error: 'moves must be a space-separated string' });
    }
    const prefix = (rawMoves ?? '').trim().replace(/\s+/g, ' ');
    // Escape LIKE metacharacters so user input can't widen the pattern match.
    const escapedPrefix = prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const prefixDepth = prefix ? prefix.split(' ').length : 0;

    // Find all games whose opening_moves start with the prefix, then extract
    // the next move token after the prefix for grouping.
    //
    // opening_moves stores the first 10 half-moves as a space-separated string.
    // For root level (empty prefix) we match all games and extract the 1st token.
    // For deeper levels we match "prefix %" and extract the token after the prefix.
    let queryText;
    let queryParams;

    if (!prefix) {
      // Root level — group by the first move
      queryText = `
        SELECT
          split_part(opening_moves, ' ', 1) AS next_move,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE result = player_color)::int AS wins,
          COUNT(*) FILTER (WHERE result = 'draw')::int AS draws,
          COUNT(*) FILTER (WHERE result IS NOT NULL AND result != 'draw' AND result != player_color)::int AS losses
        FROM external_games
        WHERE linked_account_id = $1
          AND opening_moves IS NOT NULL
          AND opening_moves != ''
        GROUP BY next_move
        ORDER BY count DESC`;
      queryParams = [account.id];
    } else {
      // Deeper level — match prefix, extract next token
      // We need games where opening_moves starts with "prefix " (note the trailing space)
      // or opening_moves equals exactly the prefix (leaf node — no next move).
      // For grouping, extract token at position (prefixDepth + 1).
      // Include exact-prefix games ($3) AND continuation games ($4) so leaf
      // nodes at the storage depth limit contribute to totals. The HAVING
      // clause filters exact-prefix rows out of the grouped next-move list
      // (they have no next token) while keeping them in the aggregate count.
      queryText = `
        SELECT
          split_part(opening_moves, ' ', $2) AS next_move,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE result = player_color)::int AS wins,
          COUNT(*) FILTER (WHERE result = 'draw')::int AS draws,
          COUNT(*) FILTER (WHERE result IS NOT NULL AND result != 'draw' AND result != player_color)::int AS losses
        FROM external_games
        WHERE linked_account_id = $1
          AND (opening_moves = $3 OR opening_moves LIKE $4 ESCAPE '\')
        GROUP BY next_move
        HAVING split_part(opening_moves, ' ', $2) != ''
        ORDER BY count DESC`;
      queryParams = [account.id, prefixDepth + 1, prefix, escapedPrefix + ' %'];
    }

    const { rows } = await pool.query(queryText, queryParams);

    // Aggregate totals — run a separate query with the SAME WHERE predicate
    // as the grouped query but without GROUP BY / HAVING, so leaf-node games
    // (opening_moves = prefix exactly, no next token) contribute to
    // totalGames/wins/draws/losses even though they're filtered out of the
    // per-move breakdown.
    const totalQuery = prefix
      ? `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE result = player_color)::int AS wins,
           COUNT(*) FILTER (WHERE result = 'draw')::int AS draws,
           COUNT(*) FILTER (WHERE result IS NOT NULL AND result != 'draw' AND result != player_color)::int AS losses
         FROM external_games
         WHERE linked_account_id = $1
           AND (opening_moves = $2 OR opening_moves LIKE $3 ESCAPE '\')`
      : `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE result = player_color)::int AS wins,
           COUNT(*) FILTER (WHERE result = 'draw')::int AS draws,
           COUNT(*) FILTER (WHERE result IS NOT NULL AND result != 'draw' AND result != player_color)::int AS losses
         FROM external_games
         WHERE linked_account_id = $1
           AND opening_moves IS NOT NULL
           AND opening_moves != ''`;
    const totalParams = prefix ? [account.id, prefix, escapedPrefix + ' %'] : [account.id];
    const { rows: [totals] } = await pool.query(totalQuery, totalParams);

    const moves = rows.map((r) => ({
      move: r.next_move,
      count: r.count,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      winRate: r.count > 0 ? Math.round((r.wins / r.count) * 1000) / 1000 : 0,
    }));

    return res.json({
      prefix: prefix || null,
      totalGames: totals.total,
      stats: {
        wins: totals.wins,
        draws: totals.draws,
        losses: totals.losses,
        winRate: totals.total > 0 ? Math.round((totals.wins / totals.total) * 1000) / 1000 : 0,
      },
      moves,
    });
  } catch (err) {
    console.error('[external] openings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
