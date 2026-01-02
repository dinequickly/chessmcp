'use client';

import { useState, useEffect, useRef } from 'react';
import { Chessboard } from "react-chessboard";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { RefreshCw, Link as LinkIcon, Send, User, Bot, MessageSquare } from "lucide-react";
import { clsx } from "clsx";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function ChessGame() {
  const [fen, setFen] = useState("start");
  const [apiUrl, setApiUrl] = useState("https://chessmcp-production.up.railway.app");
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "checking">("checking");
  const [isResetting, setIsResetting] = useState(false);
  
  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const res = await fetch(`${apiUrl}/api/tools/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new_game", args: {} })
      });
      
      if (res.ok) {
        // Fetch immediately to update UI
        const boardRes = await fetch(`${apiUrl}/api/board?t=${Date.now()}`);
        const data = await boardRes.json();
        if (data.fen) setFen(data.fen);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Game reset. White to move.' }]);
      }
    } catch (e) {
      console.error("Reset failed", e);
    } finally {
      setIsResetting(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("https://maxipad.app.n8n.cloud/webhook/2d50bb8a-725f-4d9e-b0fe-971f2f216af5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content }),
      });

      let responseText = "Sent to Agent.";
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
         const data = await response.json();
         // Prioritize 'output', then 'message', then 'text'
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
        content: "Error connecting to Agent. Please check your network or the webhook URL." 
      }]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col xl:flex-row items-start justify-center min-h-screen p-4 sm:p-8 gap-6 bg-surface-subtle">
      
      {/* Left Column: Board & Controls */}
      <div className="w-full max-w-lg space-y-6 flex flex-col">
        <div className="p-6 rounded-2xl border border-default bg-surface shadow-lg space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="heading-lg">Chess Game</h2>
            <Badge 
              color={connectionStatus === 'connected' ? 'success' : connectionStatus === 'checking' ? 'neutral' : 'danger'}
            >
              {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'checking' ? 'Checking...' : 'Disconnected'}
            </Badge>
          </div>

          <div className="aspect-square w-full rounded-lg overflow-hidden border border-subtle bg-neutral-100 relative">
             <Chessboard 
               id="SyncedBoard" 
               position={fen} 
               arePiecesDraggable={false}
               customDarkSquareStyle={{ backgroundColor: "#779556" }}
               customLightSquareStyle={{ backgroundColor: "#ebecd0" }}
             />
             {connectionStatus === 'disconnected' && (
               <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-medium backdrop-blur-sm">
                 Reconnecting...
               </div>
             )}
          </div>
        </div>

        {/* API Config (Collapsible or just small) */}
        <div className="p-4 rounded-xl border border-subtle bg-surface/50">
            <div className="flex flex-col gap-2">
             <label className="text-xs font-medium text-secondary flex items-center gap-2">
               <LinkIcon size={12} />
               API Connection URL
             </label>
             <Input 
               value={apiUrl}
               onChange={(e) => setApiUrl(e.target.value)}
               placeholder="https://..."
               size="sm"
             />
           </div>
        </div>
      </div>

      {/* Right Column: Chat Interface */}
      <div className="w-full max-w-lg xl:h-[calc(100vh-4rem)] flex flex-col rounded-2xl border border-default bg-surface shadow-lg overflow-hidden">
        <div className="p-4 border-b border-subtle bg-surface flex items-center justify-between">
           <div className="flex items-center gap-2">
             <MessageSquare className="text-primary" size={20} />
             <h3 className="heading-md">Agent Chat</h3>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-subtle/30">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-secondary p-8 opacity-60">
              <Bot size={48} className="mb-4" />
              <p className="text-sm">Talk to the agent to play chess.</p>
              <p className="text-xs mt-2">Try: "Start a new game" or "Move pawn to e4"</p>
            </div>
          )}
          
          {messages.map((m) => (
            <div
              key={m.id}
              className={clsx(
                "flex gap-3 text-sm max-w-[85%]",
                m.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto flex-row"
              )}
            >
              <div className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border border-subtle shadow-sm",
                m.role === 'user' ? "bg-primary text-on-primary" : "bg-surface text-secondary"
              )}>
                {m.role === 'user' ? <User size={14}/> : <Bot size={14}/>}
              </div>
              <div className={clsx(
                "p-3 rounded-2xl shadow-sm border",
                m.role === 'user' 
                  ? "bg-primary text-on-primary border-transparent rounded-tr-none" 
                  : "bg-surface text-primary border-subtle rounded-tl-none"
              )}>
                {m.content}
              </div>
            </div>
          ))}
          {isSending && (
             <div className="flex gap-3 text-sm mr-auto">
                <div className="w-8 h-8 rounded-full bg-surface border border-subtle flex items-center justify-center shrink-0 animate-pulse">
                    <Bot size={14}/>
                </div>
                <div className="p-3 rounded-2xl bg-surface border border-subtle text-secondary italic text-xs flex items-center">
                    Thinking...
                </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-subtle bg-surface">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <div className="flex-1">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your move..."
                  disabled={isSending}
                />
            </div>
            <Button
              type="submit"
              color="primary"
              disabled={isSending || !input.trim()}
              icon={<Send size={18} />}
            />
          </form>
        </div>
      </div>

    </div>
  );
}
