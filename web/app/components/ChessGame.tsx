'use client';

import { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useChat } from '@ai-sdk/react';
import { Send, RotateCcw, Cpu, User, Bot, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export default function ChessGame() {
  const [game, setGame] = useState(new Chess());
  const [stockfishEnabled, setStockfishEnabled] = useState(false);
  const [stockfishThinking, setStockfishThinking] = useState(false);
  const [lastMoveAnalysis, setLastMoveAnalysis] = useState<string | null>(null);

  // Chat hook from Vercel AI SDK
  const { messages, input, handleInputChange, handleSubmit, isLoading: isChatLoading } = useChat({
    api: '/api/chat',
    body: {
      fen: game.fen(),
      history: game.history().join(' '),
    },
  } as any) as any;

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Stockfish Move
  const makeStockfishMove = async (currentFen: string) => {
    if (!stockfishEnabled || game.isGameOver()) return;

    setStockfishThinking(true);
    try {
      const res = await fetch('/api/stockfish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: currentFen }),
      });
      const data = await res.json();

      if (data.move) {
        const move = data.move; // UCI format e.g. "e2e4"
        
        setGame((g) => {
          const newGame = new Chess(g.fen());
          // chess.js move() handles SAN or object. For UCI, we usually need {from, to}
          // But newer chess.js versions might handle UCI strings or we parse it.
          // Let's parse UCI "e2e4" manually to be safe.
          const from = move.substring(0, 2);
          const to = move.substring(2, 4);
          const promotion = move.length > 4 ? move.substring(4, 5) : undefined;
          
          try {
            newGame.move({ from, to, promotion });
          } catch (e) {
            console.error("Move failed", e);
          }
          return newGame;
        });

        if (data.text) {
          setLastMoveAnalysis(data.text);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setStockfishThinking(false);
    }
  };

  // Trigger stockfish if it's black's turn and enabled
  useEffect(() => {
    if (stockfishEnabled && game.turn() === 'b' && !game.isGameOver()) {
      makeStockfishMove(game.fen());
    }
  }, [game.fen(), stockfishEnabled]);

  function onDrop(sourceSquare: string, targetSquare: string) {
    if (game.turn() !== 'w' && stockfishEnabled) return false; // Prevent moving out of turn against AI

    try {
      const newGame = new Chess(game.fen());
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q', // always promote to queen for simplicity
      });

      if (!move) return false;

      setGame(newGame);
      setLastMoveAnalysis(null); // Clear previous analysis
      return true;
    } catch (e) {
      return false;
    }
  }

  return (
    <div className="flex flex-col h-screen bg-neutral-900 text-white md:flex-row overflow-hidden">
      
      {/* Left: Chess Board Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 bg-neutral-950/50 relative">
        <div className="w-full max-w-[600px] aspect-square shadow-2xl rounded-lg overflow-hidden border border-neutral-800">
          <Chessboard position={game.fen()} onPieceDrop={onDrop} boardOrientation="white" {...({} as any)} />
        </div>

        {/* Controls */}
        <div className="mt-6 flex gap-4">
          <button
            onClick={() => {
              setGame(new Chess());
              setLastMoveAnalysis(null);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-md transition-colors"
          >
            <RotateCcw size={18} /> New Game
          </button>
          
          <button
            onClick={() => setStockfishEnabled(!stockfishEnabled)}
            className={twMerge(
              "flex items-center gap-2 px-4 py-2 rounded-md transition-colors border",
              stockfishEnabled 
                ? "bg-green-900/30 border-green-700 text-green-400" 
                : "bg-neutral-800 border-transparent hover:bg-neutral-700 text-neutral-400"
            )}
          >
            <Cpu size={18} /> {stockfishEnabled ? "Stockfish: ON" : "Stockfish: OFF"}
          </button>
        </div>

        {/* Status / Analysis */}
        <div className="mt-4 h-12 text-center">
            {stockfishThinking && <span className="text-yellow-500 animate-pulse">Stockfish is thinking...</span>}
            {!stockfishThinking && game.isGameOver() && <span className="text-red-500 font-bold">Game Over!</span>}
            {!stockfishThinking && !game.isGameOver() && lastMoveAnalysis && (
                <p className="text-sm text-neutral-400 italic max-w-md mx-auto">"{lastMoveAnalysis}"</p>
            )}
        </div>
      </div>

      {/* Right: Chat Area */}
      <div className="w-full md:w-[400px] bg-neutral-900 border-l border-neutral-800 flex flex-col">
        <div className="p-4 border-b border-neutral-800 bg-neutral-900 z-10">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Bot size={20} className="text-blue-400"/> AI Assistant
          </h2>
          <p className="text-xs text-neutral-500">Ask about moves, strategy, or rules.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-neutral-600 mt-10">
              <Bot size={48} className="mx-auto mb-2 opacity-20" />
              <p>No messages yet. Ask me anything!</p>
            </div>
          )}
          
          {messages.map((m: any) => (
            <div
              key={m.id}
              className={clsx(
                "flex gap-3 text-sm",
                m.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                m.role === 'user' ? "bg-blue-600" : "bg-green-600"
              )}>
                {m.role === 'user' ? <User size={14}/> : <Bot size={14}/>}
              </div>
              <div className={clsx(
                "p-3 rounded-lg max-w-[85%]",
                m.role === 'user' ? "bg-blue-600/20 text-blue-100" : "bg-neutral-800 text-neutral-200"
              )}>
                {m.content}
              </div>
            </div>
          ))}
          {isChatLoading && (
            <div className="flex gap-3 text-sm">
                <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center shrink-0 animate-pulse">
                    <Bot size={14}/>
                </div>
                <div className="p-3 rounded-lg bg-neutral-800 text-neutral-400 italic">
                    Thinking...
                </div>
            </div>
          )}
          {/* Invisible element to scroll to */}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              className="flex-1 bg-neutral-800 border-neutral-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-neutral-500"
              value={input}
              onChange={handleInputChange}
              placeholder="e.g. Is this a good move?"
            />
            <button
              type="submit"
              disabled={isChatLoading}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 rounded-md transition-colors"
            >
              <Send size={18} />
            </button>
          </form>
          {!process.env.NEXT_PUBLIC_HAS_KEY && (
             <p className="text-[10px] text-red-400 mt-2 text-center flex items-center justify-center gap-1">
                <AlertCircle size={10}/> Note: OPENAI_API_KEY required for chat
             </p>
          )}
        </div>
      </div>
    </div>
  );
}
