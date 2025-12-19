import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { Chess } from "chess.js";
import axios from "axios";
import { z } from "zod";
import cors from "cors";

/**
 * MCP Server for playing Chess via HTTP/SSE.
 */

// Global State (Note: In a production multi-user env, map this by session ID)
let chess = new Chess();

const server = new Server(
  {
    name: "mcp-chess-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// --- MCP Handlers (Same logic as before) ---

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "chess://board",
        name: "Current Chess Board",
        mimeType: "text/plain",
        description: "The current state of the chess board in ASCII format.",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "chess://board") {
    return {
      contents: [
        {
          uri: "chess://board",
          mimeType: "text/plain",
          text: chess.ascii() + "\n\nFEN: " + chess.fen() + "\nTurn: " + (chess.turn() === 'w' ? 'White' : 'Black'),
        },
      ],
    };
  }
  throw new McpError(ErrorCode.InvalidRequest, "Resource not found");
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "move_piece",
        description: "Make a move on the chess board. Accepts SAN (e.g., 'Nf3', 'e4') or UCI (e.g., 'e2e4') notation.",
        inputSchema: {
          type: "object",
          properties: {
            move: {
              type: "string",
              description: "The move to make (SAN or UCI format).",
            },
          },
          required: ["move"],
        },
      },
      {
        name: "get_stockfish_move",
        description: "Ask the AI opponent (Stockfish via Chess-API) to make the best move for the current side. updates the board automatically.",
        inputSchema: {
          type: "object",
          properties: {}, 
        },
      },
      {
        name: "new_game",
        description: "Reset the chess board for a new game.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "move_piece": {
      const schema = z.object({ move: z.string() });
      const parsed = schema.safeParse(args);
      
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, "Invalid arguments for move_piece");
      }

      const { move } = parsed.data;

      try {
        let moveResult;
        try {
            moveResult = chess.move(move);
        } catch (e) {
            throw new Error(`Invalid move: ${move}`);
        }

        if (!moveResult) {
             throw new Error(`Invalid move: ${move}`);
        }

        return {
          content: [
            {
              type: "text",
              text: `Move ${move} played successfully. \nBoard state:\n${chess.ascii()}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error playing move: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "get_stockfish_move": {
        try {
            if (chess.isGameOver()) {
                return {
                    content: [{ type: "text", text: "Game is already over." }],
                    isError: true
                };
            }

            const currentFen = chess.fen();
            
            // Call External API
            const response = await axios.post("https://chess-api.com/v1", {
                fen: currentFen,
                depth: 12,
                maxThinkingTime: 50
            }, {
                headers: {
                    "Content-Type": "application/json"
                }
            });

            const bestMove = response.data.move; 
            const evaluation = response.data.eval;
            const text = response.data.text;

            if (!bestMove) {
                throw new Error("No move returned from API");
            }

            // Apply the move locally
            const moveResult = chess.move(bestMove);
            if (!moveResult) {
                 throw new Error(`API returned invalid move: ${bestMove}`);
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `Stockfish played: ${bestMove}\nEval: ${evaluation}\nAnalysis: ${text}\n\nBoard:\n${chess.ascii()}`
                    }
                ]
            };

        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error fetching Stockfish move: ${error.message}`
                    }
                ],
                isError: true
            };
        }
    }

    case "new_game": {
      chess.reset();
      return {
        content: [
          {
            type: "text",
            text: "New game started. Board reset.",
          },
        ],
      };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  }
});

// --- Express Server Setup ---

const app = express();
app.use(cors());

// Optional: Simple HTTP endpoints for tools (easier for basic n8n nodes)
app.use(express.json());

app.get("/api/board", (req, res) => {
    res.json({ 
        fen: chess.fen(), 
        ascii: chess.ascii(), 
        turn: chess.turn() 
    });
});

let transport: SSEServerTransport | null = null;

app.get("/sse", async (req, res) => {
  console.log("New SSE connection established");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
  
  // Keep connection open
  req.on("close", () => {
    console.log("SSE connection closed");
    // Clean up if necessary
  });
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No active transport");
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Chess MCP Server listening on port ${port}`);
  console.log(`SSE Endpoint: http://localhost:${port}/sse`);
  console.log(`Messages Endpoint: http://localhost:${port}/messages`);
  console.log(`Simple Board API: http://localhost:${port}/api/board`);
});