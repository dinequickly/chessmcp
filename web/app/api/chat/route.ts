import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, fen, history } = await req.json();

  // Create a system message that gives the AI context about the game
  const systemMessage = {
    role: 'system',
    content: `You are a Chess Grandmaster assistant. 
    The current board state (FEN) is: ${fen}.
    The move history is: ${history}.
    
    Analyze the position and answer the user's questions. 
    Be concise, helpful, and friendly. 
    If the user asks for a move suggestion, explain the strategic reasoning.
    Do not use markdown for the whole response, but you can use bold/italics.`
  };

  const result = await streamText({
    model: openai('gpt-4o'),
    messages: [systemMessage, ...messages],
  });

  return result.toTextStreamResponse();
}
