import { Chess } from 'chess.js';
import { getClocks, switchClock, stopClocks, addIncrement } from './clockManager.js';
import { publishGameFinished } from './publisher.js';

/**
 * Validate and apply a move. Updates FEN in Redis, switches clocks,
 * and broadcasts a state_update (or game_over) to all players in the room.
 *
 * @param {object}  opts
 * @param {object}  opts.room      - Room instance
 * @param {object}  opts.client    - The WebSocket client who sent the move
 * @param {object}  opts.payload   - { gameId, from, to, promotion? }
 * @param {object}  opts.redis     - ioredis client
 * @param {object}  opts.pgPool    - pg Pool
 */
export async function handleMove({ room, client, payload, redis, pgPool }) {
  const { gameId, from, to, promotion } = payload;

  // Only the player whose turn it is may move
  const fenStr = await redis.get(`game:${gameId}:fen`);
  if (!fenStr) {
    return send(client, { type: 'error', message: 'Game not found' });
  }

  const chess = new Chess(fenStr);
  const turn = chess.turn(); // 'w' | 'b'
  const expectedColour = turn === 'w' ? 'white' : 'black';

  if (room.playerColour(client) !== expectedColour) {
    return send(client, { type: 'error', message: 'Not your turn' });
  }

  // Server-side move validation — client is never trusted
  let result;
  try {
    result = chess.move({ from, to, promotion: promotion ?? 'q' });
  } catch {
    return send(client, { type: 'error', message: 'Illegal move' });
  }

  const newFen = chess.fen();
  await redis.set(`game:${gameId}:fen`, newFen);

  // Switch clock: it is now the other player's turn
  const nextColour = expectedColour === 'white' ? 'black' : 'white';
  // Switch the running clock to the opponent, then credit the mover's increment.
  // Increment is always granted — on move 1 white's clock wasn't running so no
  // time is deducted, but they still earn the +increment (e.g. 3+2 → 3:02).
  await switchClock(redis, gameId, nextColour);
  await addIncrement(redis, gameId, expectedColour, room.incrementMs);
  const clocks = await getClocks(redis, gameId);

  // Persist move to postgres
  await pgPool.query(
    `INSERT INTO moves (game_id, move_number, san, fen, clock_white, clock_black)
     VALUES ($1, (SELECT COALESCE(MAX(move_number),0)+1 FROM moves WHERE game_id=$1), $2, $3, $4, $5)`,
    [gameId, result.san, newFen, clocks.white, clocks.black]
  );

  // Check for terminal states
  if (chess.isGameOver()) {
    await stopClocks(redis, gameId);

    let gameResult, reason;
    if (chess.isCheckmate()) {
      // The player who just moved wins
      gameResult = expectedColour;
      reason = 'checkmate';
    } else if (chess.isStalemate()) {
      gameResult = 'draw';
      reason = 'stalemate';
    } else if (chess.isInsufficientMaterial()) {
      gameResult = 'draw';
      reason = 'insufficient_material';
    } else if (chess.isThreefoldRepetition()) {
      gameResult = 'draw';
      reason = 'threefold_repetition';
    } else {
      gameResult = 'draw';
      reason = 'draw';
    }

    await pgPool.query(
      `UPDATE games SET status='finished', result=$1, ended_at=NOW() WHERE id=$2`,
      [gameResult, gameId]
    );

    room.broadcast({ type: 'game_over', result: gameResult, reason });
    await publishGameFinished({
      gameId,
      result: gameResult,
      reason,
      whiteId: room.whiteId,
      blackId: room.blackId,
    });
    return;
  }

  // Check for flag fall (clock hit 0)
  if (clocks[expectedColour] <= 0) {
    await stopClocks(redis, gameId);
    const loser = expectedColour;
    const winner = loser === 'white' ? 'black' : 'white';
    await pgPool.query(
      `UPDATE games SET status='finished', result=$1, ended_at=NOW() WHERE id=$2`,
      [winner, gameId]
    );
    room.broadcast({ type: 'game_over', result: winner, reason: 'timeout' });
    await publishGameFinished({
      gameId,
      result: winner,
      reason: 'timeout',
      whiteId: room.whiteId,
      blackId: room.blackId,
    });
    return;
  }

  // Broadcast new state to all players in the room
  room.broadcast({
    type: 'state_update',
    fen: newFen,
    clocks: { white: clocks.white, black: clocks.black },
    clocksStarted: clocks.started,
    turn: chess.turn() === 'w' ? 'white' : 'black',
  });
}

function send(ws, data) {
  if (ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(data));
  }
}
