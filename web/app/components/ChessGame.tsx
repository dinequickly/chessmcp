'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Chess } from 'chess.js';

// Dynamically import Chessboard with SSR disabled to prevent build hangs
const Chessboard = dynamic(() => import("react-chessboard").then((mod) => mod.Chessboard), { 
  ssr: false,
  loading: () => <div className="w-full h-full bg-neutral-100 animate-pulse flex items-center justify-center text-xs text-secondary">Loading Board...</div>
});

export default function ChessGame() {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const apiUrl = "https://chessmcp-production.up.railway.app";
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "checking">("checking");
  const isMovingRef = useRef(false);
  
  // Poll the remote board state to stay in sync if the Agent makes a move elsewhere
  useEffect(() => {
    const fetchBoard = async () => {
      if (isMovingRef.current) return; // Don't poll while user is dragging/moving

      try {
        const res = await fetch(`${apiUrl}/api/board?t=${Date.now()}`);
        if (!res.ok) throw new Error("Network response was not ok");
        
        const data = await res.json();
        
        // Only update if remote state is different (avoids jitter)
        if (data.fen && data.fen !== game.fen()) {
          const newGame = new Chess(data.fen);
          setGame(newGame);
          setFen(data.fen);
        }
        setConnectionStatus("connected");
      } catch (e) {
        setConnectionStatus("disconnected");
      }
    };

    fetchBoard(); // Initial fetch
    const interval = setInterval(fetchBoard, 2000);
    return () => clearInterval(interval);
  }, [apiUrl, game]);

  async function onPieceDrop(sourceSquare: string, targetSquare: string) {
    if (isMovingRef.current) return false;
    isMovingRef.current = true;

    try {
      const tempGame = new Chess(game.fen());
      const move = tempGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q', // always promote to queen for simplicity
      });

      if (!move) {
        isMovingRef.current = false;
        return false;
      }

      // Optimistic update
      setGame(tempGame);
      setFen(tempGame.fen());

      // 1. Send Player Move to Backend
      await fetch(`${apiUrl}/api/tools/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "move_piece", args: { move: move.san } })
      });

      // 2. Trigger Stockfish Response automatically
      // Use a small delay to make it feel natural
      setTimeout(async () => {
         try {
             const res = await fetch(`${apiUrl}/api/tools/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "get_stockfish_move", args: {} })
             });
             const data = await res.json();
             // The polling loop will pick up the new state, or we could manually set it here
             // if the API returns the new FEN.
         } catch (e) {
             console.error("Stockfish failed", e);
         } finally {
             isMovingRef.current = false;
         }
      }, 500);

      return true;
    } catch (e) {
      isMovingRef.current = false;
      return false;
    }
  }

  return (
    <div className="h-screen w-full bg-surface-subtle flex flex-col items-center justify-center p-2 overflow-hidden">
      
      {/* Board Container */}
      <div className="w-full max-w-md h-full flex flex-col">
        <div className="p-3 rounded-2xl border border-default bg-surface shadow-lg flex-1 flex flex-col min-h-0 relative">
          
          {/* Header */}
          <div className="flex items-center justify-between shrink-0 mb-3 px-1">
            <h2 className="heading-sm">Chess Game</h2>
            <Badge 
              color={connectionStatus === 'connected' ? 'success' : connectionStatus === 'checking' ? 'neutral' : 'danger'}
            >
              {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'checking' ? 'Checking...' : 'Disconnected'}
            </Badge>
          </div>

          {/* Board Area */}
          <div className="flex-1 min-h-0 relative flex items-center justify-center bg-neutral-100 rounded-lg border border-subtle overflow-hidden">
             {/* Padding helps pieces not get cut off by overflow hidden */}
             <div className="aspect-square h-full w-full p-1">
               <Chessboard 
                 id="SyncedBoard" 
                 position={fen} 
                 onPieceDrop={onPieceDrop}
                 arePiecesDraggable={true}
                 customDarkSquareStyle={{ backgroundColor: "#779556" }}
                 customLightSquareStyle={{ backgroundColor: "#ebecd0" }}
               />
             </div>
             {connectionStatus === 'disconnected' && (
               <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-medium backdrop-blur-sm z-10">
                 Reconnecting...
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}