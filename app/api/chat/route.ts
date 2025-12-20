import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const webhookUrl =
      process.env.N8N_CHAT_WEBHOOK_URL ??
      process.env.NEXT_PUBLIC_N8N_CHAT_WEBHOOK_URL ??
      'https://maxipad.app.n8n.cloud/webhook/image'

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const text = await res.text()
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Upstream chat request failed', status: res.status, body: text },
        { status: 502 },
      )
    }

    // Pass through as JSON when possible, otherwise return a string.
    try {
      return NextResponse.json(JSON.parse(text))
    } catch {
      return NextResponse.json({ message: text })
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
