'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/lib/supabaseClient'

type SessionContextValue = {
  sessionId: string | null
  loading: boolean
  error: string | null
  ensureSession: () => Promise<void>
}

const STORAGE_KEY = 'image_platform_session_id'

const SessionContext = createContext<SessionContextValue | null>(null)

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'
}

async function ensureSessionRow(id: string) {
  // Prefer a server-side insert (service role key) when available; fall back to client insert.
  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      cache: 'no-store',
    })
    if (res.ok) return
  } catch {
    // ignore; try client insert
  }

  const { error } = await supabase.from('sessions').insert({ id })
  if (error && !isDuplicateKeyError(error)) throw error
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const initInFlight = useRef<Promise<void> | null>(null)

  const ensureSession = useCallback(async () => {
    if (initInFlight.current) return initInFlight.current

    initInFlight.current = (async () => {
      setLoading(true)
      setError(null)

      try {
        const storedSessionId = localStorage.getItem(STORAGE_KEY)

        if (storedSessionId) {
          setSessionId(storedSessionId)
          await ensureSessionRow(storedSessionId)
          return
        }

        // Create a new session ID and write it immediately to avoid duplicate creation in React Strict Mode.
        const newId = uuidv4()
        localStorage.setItem(STORAGE_KEY, newId)
        setSessionId(newId)

        await ensureSessionRow(newId)
      } catch (e: unknown) {
        const message = getErrorMessage(e) || 'Failed to initialize session'
        setError(
          `${message}\n\nIf you enabled RLS on the "sessions" table, add an INSERT policy (or disable RLS), or set SUPABASE_SERVICE_ROLE_KEY so /api/session can create rows server-side.`,
        )
      } finally {
        setLoading(false)
        initInFlight.current = null
      }
    })()

    return initInFlight.current
  }, [])

  useEffect(() => {
    void ensureSession()
  }, [ensureSession])

  const value = useMemo<SessionContextValue>(
    () => ({ sessionId, loading, error, ensureSession }),
    [sessionId, loading, error, ensureSession],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSessionContext() {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession must be used within <SessionProvider>')
  }
  return ctx
}
