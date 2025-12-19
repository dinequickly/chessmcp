'use client';

import { useState, useEffect, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Send, User, Bot, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function ChessGame() {
  const [fen, setFen] = useState("start");
  const [turn, setTurn] = useState("w");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Poll the remote board state every 2 seconds
  useEffect(() => {
    const fetchBoard = async () => {
      try {
        const res = await fetch("https://chessmcp-production.up.railway.app/api/board");
        const data = await res.json();
        if (data.fen) {
          setFen(data.fen);
          setTurn(data.turn);
        }
      } catch (e) {
        console.error("Failed to fetch board:", e);
      }
    };

    fetchBoard();
    const interval = setInterval(fetchBoard, 2000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("https://maxipad.app.n8n.cloud/webhook/2d50bb8a-725f-4d9e-b0fe-971f2f216af5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content }),
      });

      let responseText = "Sent to Agent.";
      // Try to parse JSON response if n8n returns one, otherwise use text
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
         const data = await response.json();
         // Assuming n8n returns { output: "..." } or similar. Adjust based on actual n8n workflow.
         // If it returns array of objects, or just a string property.
         // Defaulting to dumping the JSON if unknown structure, or looking for common keys.
         responseText = data.output || data.message || data.text || JSON.stringify(data);
      } else {
         responseText = await response.text();
      }

      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText || "Command received.",
      };
      setMessages((prev) => [...prev, botMsg]);

    } catch (e) {
      console.error(e);
      setMessages((prev) => [...prev, { 
        id: Date.now().toString(), 
        role: 'assistant', 
        content: "Error connecting to Agent." 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-900 text-white md:flex-row overflow-hidden">
      
      {/* Left: Chess Board Area (Read Only View) */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 bg-neutral-950/50 relative">
        <div className="absolute top-4 left-4 text-neutral-500 text-xs font-mono">
            Connected to: chessmcp-production.up.railway.app
        </div>

        <div className="w-full max-w-[600px] aspect-square shadow-2xl rounded-lg overflow-hidden border border-neutral-800 pointer-events-none">
           {/* Pointer events none to prevent moving pieces locally since it's a view */}
          <Chessboard position={fen} boardOrientation="white" {...({} as any)} />
        </div>

        <div className="mt-4 flex flex-col items-center gap-2">
           <div className="flex items-center gap-2 text-neutral-400">
             <div className={clsx("w-3 h-3 rounded-full", turn === 'w' ? "bg-white" : "bg-neutral-800 border border-white")}></div>
             <span>{turn === 'w' ? "White" : "Black"}'s Turn</span>
           </div>
           <p className="text-sm text-neutral-500 max-w-md text-center">
             Moves are controlled by the Agent. Use the chat to suggest moves or ask questions.
           </p>
        </div>
      </div>

      {/* Right: Chat Area */}
      <div className="w-full md:w-[400px] bg-neutral-900 border-l border-neutral-800 flex flex-col">
        <div className="p-4 border-b border-neutral-800 bg-neutral-900 z-10 flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2">
                <Bot size={20} className="text-purple-400"/> Agent Chat
            </h2>
            <p className="text-xs text-neutral-500">Connected to n8n Webhook</p>
          </div>
          <button onClick={() => setMessages([])} className="text-neutral-600 hover:text-white" title="Clear Chat">
             <RefreshCw size={14}/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-neutral-600 mt-10">
              <Bot size={48} className="mx-auto mb-2 opacity-20" />
              <p>Hello! I control the chess board.</p>
              <p className="text-xs mt-2">Try: "Move pawn to e4"</p>
            </div>
          )}
          
          {messages.map((m) => (
            <div
              key={m.id}
              className={clsx(
                "flex gap-3 text-sm",
                m.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                m.role === 'user' ? "bg-blue-600" : "bg-purple-600"
              )}>
                {m.role === 'user' ? <User size={14}/> : <Bot size={14}/>}
              </div>
              <div className={clsx(
                "p-3 rounded-lg max-w-[85%] whitespace-pre-wrap",
                m.role === 'user' ? "bg-blue-600/20 text-blue-100" : "bg-neutral-800 text-neutral-200"
              )}>
                {m.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3 text-sm">
                <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center shrink-0 animate-pulse">
                    <Bot size={14}/>
                </div>
                <div className="p-3 rounded-lg bg-neutral-800 text-neutral-400 italic">
                    Thinking...
                </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              className="flex-1 bg-neutral-800 border-neutral-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-white placeholder-neutral-500"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
            />
            <button
              type="submit"
              disabled={isLoading}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 rounded-md transition-colors"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
