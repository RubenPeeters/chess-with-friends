import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useMemo } from 'react';

export function Board({ fen, playerColour, onMove, gameOver, animated = true }) {
  // Skip building a Chess instance in review mode — onDrop returns false
  // immediately when gameOver is true, so the instance is never used.
  const chess = useMemo(() => {
    if (gameOver) return null;
    try { return new Chess(fen === 'start' ? undefined : fen); }
    catch { return new Chess(); }
  }, [fen, gameOver]);

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
    <div className="bg-white rounded-2xl p-3 shadow-[0_8px_40px_rgba(0,0,0,0.10)] w-full max-w-[560px] border border-surface-high">
      <Chessboard
        position={fen === 'start' ? 'start' : fen}
        onPieceDrop={onDrop}
        boardOrientation={playerColour}
        animationDuration={animated ? 200 : 0}
        customBoardStyle={{ borderRadius: '0.75rem', overflow: 'hidden' }}
        customDarkSquareStyle={{ backgroundColor: '#769656' }}
        customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
        arePiecesDraggable={!gameOver}
      />
    </div>
  );
}
