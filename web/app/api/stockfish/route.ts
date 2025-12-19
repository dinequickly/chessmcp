import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { fen, depth = 12 } = await req.json();

    const response = await fetch("https://chess-api.com/v1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fen,
        depth,
        maxThinkingTime: 50,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chess API error: ${response.statusText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
