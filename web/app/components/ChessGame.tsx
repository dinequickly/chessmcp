'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Badge } from "@openai/apps-sdk-ui/components/Badge";

// Dynamically import Chessboard with SSR disabled to prevent build hangs
const Chessboard = dynamic(() => import("react-chessboard").then((mod) => mod.Chessboard), { 
  ssr: false,
  loading: () => <div className="w-full h-full bg-neutral-100 animate-pulse flex items-center justify-center text-xs text-secondary">Loading Board...</div>
});

export default function ChessGame() {
  const [fen, setFen] = useState("start");
  const apiUrl = "https://chessmcp-production.up.railway.app";
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "checking">("checking");
  
  // Poll the remote board state
  useEffect(() => {
    const fetchBoard = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/board?t=${Date.now()}`);
        if (!res.ok) throw new Error("Network response was not ok");
        
        const data = await res.json();
        
        if (data.fen) {
          setFen(data.fen);
          setConnectionStatus("connected");
        }
      } catch (e) {
        setConnectionStatus("disconnected");
      }
    };

    fetchBoard(); // Initial fetch
    const interval = setInterval(fetchBoard, 2000);
    return () => clearInterval(interval);
  }, [apiUrl]);

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
                 arePiecesDraggable={false}
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