import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const id = typeof body === 'object' && body !== null && 'id' in body ? (body as { id?: unknown }).id : undefined
  if (typeof id !== 'string' || !isUuid(id)) {
    return NextResponse.json({ ok: false, error: 'Invalid session id' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Server not configured for session creation',
        hint: 'Set SUPABASE_SERVICE_ROLE_KEY (server-only) or allow inserts via RLS policy on sessions.',
      },
      { status: 500 },
    )
  }

  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await supabaseAdmin.from('sessions').insert({ id })
  if (error && !isDuplicateKeyError(error)) {
    return NextResponse.json({ ok: false, error: error.message, details: error }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}

