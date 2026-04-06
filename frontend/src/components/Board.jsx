import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useMemo } from 'react';

export function Board({ fen, playerColour, onMove, gameOver }) {
  const chess = useMemo(() => {
    try { return new Chess(fen === 'start' ? undefined : fen); }
    catch { return new Chess(); }
  }, [fen]);

  function onDrop(sourceSquare, targetSquare, piece) {
    if (gameOver) return false;
    const moves = chess.moves({ square: sourceSquare, verbose: true });
    const match = moves.find((m) => m.from === sourceSquare && m.to === targetSquare);
    if (!match) return false;
    const needsPromotion =
      match.flags.includes('p') ||
      (piece[1] === 'P' && (targetSquare[1] === '8' || targetSquare[1] === '1'));
    onMove(sourceSquare, targetSquare, needsPromotion ? 'q' : undefined);
    return true;
  }

  return (
    /* surface-container-lowest card — elevated by ambient shadow, no border */
    <div style={css.card}>
      <Chessboard
        position={fen === 'start' ? 'start' : fen}
        onPieceDrop={onDrop}
        boardOrientation={playerColour}
        customBoardStyle={{ borderRadius: '0.5rem', overflow: 'hidden' }}
        customDarkSquareStyle={{ backgroundColor: '#4a7c59' }}
        customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
        arePiecesDraggable={!gameOver}
      />
    </div>
  );
}

const css = {
  card: {
    background: 'var(--surface-lowest)',
    borderRadius: 'var(--radius-md)',
    padding: '1rem',
    boxShadow: 'var(--ambient-shadow-raised)',
    width: '100%',
    maxWidth: 560,
  },
};
