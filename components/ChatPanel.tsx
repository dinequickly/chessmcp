'use client'

import React, { useMemo, useRef, useEffect, useState } from 'react'
import { Bot, ChevronLeft, ChevronRight, Loader2, Send, User } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useSupabaseUser } from '@/hooks/useSupabaseUser'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export default function ChatPanel({ className }: { className?: string }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const { sessionId } = useSession()
  const { user } = useSupabaseUser()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const subtitle = useMemo(() => {
    if (!sessionId) return 'Connecting...'
    return 'Ask about edits, search, or vibes'
  }, [sessionId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMsg: Message = {
      id: Math.random().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            message: userMsg.content,
            session_id: sessionId,
            user_id: user?.id 
        })
      })

      if (!response.ok) throw new Error('Failed to send message')

      const data = await response.json()
      
      // Assume response has a 'output' or 'text' or 'message' field, falling back to JSON string
      const replyText = typeof data === 'string' ? data : (data.output || data.text || data.message || JSON.stringify(data))

      const botMsg: Message = {
        id: Math.random().toString(),
        role: 'assistant',
        content: replyText,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, botMsg])
    } catch (error) {
      console.error('Chat error:', error)
      const errorMsg: Message = {
        id: Math.random().toString(),
        role: 'assistant',
        content: "Sorry, I couldn't reach the server. Please try again.",
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={[
        'flex flex-col rounded-2xl border border-gray-200 bg-white/70 shadow-sm backdrop-blur',
        isCollapsed ? 'h-auto' : 'h-[520px] lg:h-[calc(100dvh-12rem)]',
        className ?? '',
      ].join(' ')}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white rounded-t-2xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <h3 className="font-semibold text-gray-900">Assistant</h3>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed((v) => !v)}
          className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
          aria-label={isCollapsed ? 'Expand chat' : 'Collapse chat'}
        >
          {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gradient-to-b from-gray-50 to-white">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 mt-10 text-sm">
                <p>Drop a prompt and I’ll help.</p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <div
                  className={[
                    'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm',
                    msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-blue-600 text-white',
                  ].join(' ')}
                >
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div
                  className={[
                    'max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
                    msg.role === 'user'
                      ? 'bg-gray-900 text-white rounded-tr-md'
                      : 'bg-white border border-gray-200 text-gray-800 rounded-tl-md shadow-sm',
                  ].join(' ')}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-white border border-gray-200 px-3.5 py-2.5 rounded-2xl rounded-tl-md shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-gray-200 bg-white rounded-b-2xl">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message…"
                className="flex-1 border border-gray-300 bg-white/90 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600/40 focus:border-blue-600/40"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="bg-gray-900 text-white px-3.5 py-2.5 rounded-xl hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
            <p className="mt-2 text-[11px] text-gray-400">
              Sends <code className="font-mono text-gray-500">session_id</code> {sessionId ? '✓' : '…'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
