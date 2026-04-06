import { useEffect, useRef, useCallback, useState } from 'react';

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Manages the WebSocket connection to the game service.
 *
 * Protocol rules:
 *  - JWT is sent in the Authorization header during the WS handshake.
 *  - After connecting (or reconnecting), a `rejoin` message is sent so the
 *    server replays the current FEN + clocks.
 *  - The client treats every `state_update` as authoritative and resets its
 *    local display counters from it.
 *
 * @param {string|null} gameId
 * @param {string|null} token - JWT
 * @returns {{ gameState, sendMove, sendResign, sendDrawOffer, connected }}
 */
export function useGameSocket(gameId, token) {
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const intentionalCloseRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState({
    fen: 'start',
    clocks: { white: null, black: null },
    turn: 'white',
    clocksStarted: false, // true only after white's first move
    gameOver: null,
  });

  const connect = useCallback(() => {
    if (!gameId || !token) return;

    // Browser WebSocket API cannot set custom headers, so the JWT travels as ?token=.
    // VITE_WS_BASE_URL is set in .env.development to point directly at Caddy (ws://localhost)
    // because Vite's WS proxy conflicts with its own HMR socket on the same port.
    // In production the env var is empty and we fall back to same-origin.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = import.meta.env.VITE_WS_BASE_URL || `${proto}://${location.host}`;
    const wsUrl = `${base}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      // Rejoin immediately so the server replays state
      ws.send(JSON.stringify({ type: 'rejoin', gameId }));
      // Start keepalive pings
      ws._pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25_000);
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'state_update':
          setGameState((prev) => ({
            ...prev,
            fen: msg.fen,
            clocks: msg.clocks,
            turn: msg.turn,
            clocksStarted: msg.clocksStarted ?? prev.clocksStarted,
          }));
          break;

        case 'game_over':
          setGameState((prev) => ({
            ...prev,
            gameOver: { result: msg.result, reason: msg.reason },
          }));
          break;

        case 'pong':
          // Keepalive acknowledged — nothing to do
          break;

        case 'draw_offer':
          // Surface to the UI via state so the opponent can respond
          setGameState((prev) => ({ ...prev, drawOffer: msg.from }));
          break;

        case 'error':
          console.warn('[ws] server error:', msg.message);
          break;
      }
    };

    ws.onclose = () => {
      clearInterval(ws._pingInterval);
      setConnected(false);

      if (intentionalCloseRef.current) return;

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        const delay = RECONNECT_DELAY_MS * reconnectAttemptsRef.current;
        console.log(`[ws] reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      } else {
        console.error('[ws] max reconnect attempts reached');
      }
    };

    ws.onerror = (err) => {
      console.error('[ws] error', err);
    };
  }, [gameId, token]);

  useEffect(() => {
    intentionalCloseRef.current = false;
    connect();
    return () => {
      intentionalCloseRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        clearInterval(wsRef.current._pingInterval);
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendMove = useCallback(({ from, to, promotion }) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'move', gameId, from, to, promotion }));
    }
  }, [gameId]);

  const sendResign = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resign', gameId }));
    }
  }, [gameId]);

  const sendDrawOffer = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'draw_offer', gameId }));
    }
  }, [gameId]);

  return { gameState, sendMove, sendResign, sendDrawOffer, connected };
}
