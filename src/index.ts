import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

/**
 * MCP Server for playing Chess via HTTP/SSE and OpenAI Apps SDK.
 */

// Global State (Note: In a production multi-user env, map this by session ID)
let chess = new Chess();

// Helper to get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the widget HTML
// Adjust path based on where built file runs. Assuming 'dist/index.js', we go up one level.
const widgetPath = path.join(process.cwd(), 'public', 'chess-widget.html');
let widgetHtml = "";
try {
    widgetHtml = fs.readFileSync(widgetPath, 'utf8');
} catch (e) {
    console.error("Could not read chess-widget.html from", widgetPath, e);
    widgetHtml = "<h1>Error: Widget not found</h1>";
}

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

// --- MCP Handlers ---

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "chess://board",
        name: "Current Chess Board",
        mimeType: "text/plain",
        description: "The current state of the chess board in ASCII format.",
      },
      // OpenAI Widget Resource
      {
        uri: "ui://widget/chess.html",
        name: "Chess Widget",
        mimeType: "text/html",
        description: "Interactive Chess Board Widget",
      }
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
  if (request.params.uri === "ui://widget/chess.html") {
      return {
          contents: [
              {
                  uri: "ui://widget/chess.html",
                  mimeType: "text/html",
                  text: widgetHtml,
                  // OpenAI specific metadata to prefer borderless or specific display
                  // _meta: { "openai/widgetPrefersBorder": true } 
              }
          ]
      }
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
        // OpenAI Metadata for Widget Interaction
        // This tells OpenAI to show the widget when this tool is called/invoked
        // @ts-ignore
        _meta: {
            "openai/outputTemplate": "ui://widget/chess.html",
            "openai/toolInvocation/invoking": "Making move...",
            "openai/toolInvocation/invoked": "Move made",
        }
      },
      {
        name: "get_stockfish_move",
        description: "Ask the AI opponent (Stockfish) to make the best move.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        // @ts-ignore
        _meta: {
            "openai/outputTemplate": "ui://widget/chess.html",
            "openai/toolInvocation/invoking": "Thinking...",
            "openai/toolInvocation/invoked": "Stockfish moved",
        }
      },
      {
        name: "new_game",
        description: "Reset the chess board for a new game.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        // @ts-ignore
        _meta: {
             "openai/outputTemplate": "ui://widget/chess.html",
             "openai/toolInvocation/invoking": "Resetting board...",
             "openai/toolInvocation/invoked": "Board reset",
        }
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  // Helper to return format compatible with both standard MCP and OpenAI Widget
  const makeResponse = (text: string, isError = false) => {
      return {
          content: [{ type: "text", text: text }],
          isError,
          // Extra data for the widget
          // @ts-ignore
          structuredContent: {
              fen: chess.fen(),
              ascii: chess.ascii(),
              lastMove: text
          }
      };
  };

  switch (name) {
    case "move_piece": {
      const schema = z.object({ move: z.string() });
      const parsed = schema.safeParse(args);
      if (!parsed.success) throw new McpError(ErrorCode.InvalidParams, "Invalid arguments");

      const { move } = parsed.data;

      try {
        let moveResult;
        try { moveResult = chess.move(move); } 
        catch (e) { throw new Error(`Invalid move: ${move}`); }
        if (!moveResult) throw new Error(`Invalid move: ${move}`);

        return makeResponse(`Move ${move} played successfully.`);
      } catch (error: any) {
        return makeResponse(`Error: ${error.message}`, true);
      }
    }

    case "get_stockfish_move": {
        try {
            if (chess.isGameOver()) return makeResponse("Game is already over.", true);

            const currentFen = chess.fen();
            const response = await axios.post("https://chess-api.com/v1", {
                fen: currentFen,
                depth: 12,
                maxThinkingTime: 50
            }, { headers: { "Content-Type": "application/json" } });

            const bestMove = response.data.move;
            if (!bestMove) throw new Error("No move from Stockfish");

            chess.move(bestMove);
            return makeResponse(`Stockfish played ${bestMove}. Eval: ${response.data.eval}`);
        } catch (error: any) {
            return makeResponse(`Error: ${error.message}`, true);
        }
    }

    case "new_game": {
      chess.reset();
      return makeResponse("New game started.");
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  }
});

// --- Express Server Setup ---

const app = express();
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
    exposedHeaders: ['Mcp-Session-Id'] // Critical for OpenAI
}));

// DO NOT use global express.json() as it consumes streams for MCP transports
// app.use(express.json()); 

app.get("/api/board", (req, res) => {
    res.json({
        fen: chess.fen(), 
        ascii: chess.ascii(), 
        turn: chess.turn() 
    });
});

// Reuse logic for direct API tool call (simplified for n8n/debug)
// We need express.json() here specifically
app.post("/api/tools/run", express.json(), async (req, res) => {
    const { name, args } = req.body;
    try {
        let result;
        if (name === "move_piece") {
            chess.move(args.move);
            result = { content: `Moved ${args.move}` };
        } else if (name === "new_game") {
            chess.reset();
            result = { content: "Reset" };
        } else if (name === "get_stockfish_move") {
             const response = await axios.post("https://chess-api.com/v1", { fen: chess.fen() });
             chess.move(response.data.move);
             result = { content: `AI Moved ${response.data.move}` };
        }
        res.json(result);
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

// --- OpenAI / Streamable HTTP Transport ---

// Factory function to create a fresh server instance for every request (Stateless Mode)
function createChessServer() {
    // Re-instantiate the server for this request
    const srv = new Server(
      { name: "mcp-chess-server", version: "1.0.0" },
      { capabilities: { resources: {}, tools: {} } }
    );

    // Register Resources
    srv.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
            { uri: "chess://board", name: "Current Chess Board", mimeType: "text/plain" },
            { uri: "ui://widget/chess.html", name: "Chess Widget", mimeType: "text/html" }
        ]
    }));

    srv.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        if (request.params.uri === "chess://board") {
            return { contents: [{ uri: "chess://board", mimeType: "text/plain", text: chess.ascii() + "\n\nFEN: " + chess.fen() }] };
        }
        if (request.params.uri === "ui://widget/chess.html") {
            return { contents: [{ uri: "ui://widget/chess.html", mimeType: "text/html", text: widgetHtml }] };
        }
        throw new McpError(ErrorCode.InvalidRequest, "Resource not found");
    });

    // Register Tools
    srv.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "move_piece",
                description: "Make a move on the chess board.",
                inputSchema: {
                    type: "object",
                    properties: { move: { type: "string" } },
                    required: ["move"]
                },
                // @ts-ignore
                _meta: {
                    "openai/outputTemplate": "ui://widget/chess.html",
                    "openai/toolInvocation/invoking": "Making move...",
                    "openai/toolInvocation/invoked": "Move made",
                }
            },
            {
                name: "get_stockfish_move",
                description: "Ask Stockfish to move.",
                inputSchema: { type: "object", properties: {} },
                // @ts-ignore
                _meta: {
                    "openai/outputTemplate": "ui://widget/chess.html",
                    "openai/toolInvocation/invoking": "Thinking...",
                    "openai/toolInvocation/invoked": "Stockfish moved",
                }
            },
            {
                name: "new_game",
                description: "Reset board.",
                inputSchema: { type: "object", properties: {} },
                // @ts-ignore
                _meta: {
                     "openai/outputTemplate": "ui://widget/chess.html",
                     "openai/toolInvocation/invoking": "Resetting...",
                     "openai/toolInvocation/invoked": "Reset",
                }
            }
        ]
    }));

    // Register Call Tool Logic
    srv.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const makeResponse = (text: string, isError = false) => ({
            content: [{ type: "text", text: text }],
            isError,
            // @ts-ignore
            structuredContent: { fen: chess.fen(), ascii: chess.ascii(), lastMove: text }
        });

        if (name === "move_piece") {
            try {
                // @ts-ignore
                const m = args.move as string;
                if (!chess.move(m)) throw new Error("Invalid move");
                return makeResponse(`Moved ${m}`);
            } catch (e: any) { return makeResponse(e.message, true); }
        }
        if (name === "get_stockfish_move") {
             if (chess.isGameOver()) return makeResponse("Game Over");
             const response = await axios.post("https://chess-api.com/v1", { fen: chess.fen(), depth: 10 });
             chess.move(response.data.move);
             return makeResponse(`Stockfish: ${response.data.move}`);
        }
        if (name === "new_game") {
            chess.reset();
            return makeResponse("Reset.");
        }
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
    });

    return srv;
}

// Handle Preflight OPTIONS
app.options("/mcp", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.status(204).end();
});

// Handle GET (Health Check / Discovery)
app.get("/mcp", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send("Chess MCP Server Active");
});

// Handle POST (Actual MCP Traffic)
app.post("/mcp", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    
    // Create Fresh Server & Transport per Request (Stateless Pattern)
    const serverInstance = createChessServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless
        enableJsonResponse: true,
    });

    try {
        await serverInstance.connect(transport);
        await transport.handleRequest(req, res);
    } catch (error) {
        console.error("MCP Request Error:", error);
        if (!res.headersSent) res.status(500).send("Internal Server Error");
    } finally {
        serverInstance.close(); 
    }
});

// --- SSE Transport ---

let sseTransport: SSEServerTransport | null = null;

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  
  const host = req.headers.host; 
  const protocol = host?.includes("localhost") ? "http" : "https";
  const endpoint = `${protocol}://${host}/messages`;
  
  sseTransport = new SSEServerTransport(endpoint, res);
  await server.connect(sseTransport);
  
  const interval = setInterval(() => {
      if (!res.writableEnded) res.write(":\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

app.post("/messages", async (req, res) => {
  if (!sseTransport) {
      res.status(400).send("No active transport");
      return;
  }
  
  try {
      await sseTransport.handlePostMessage(req, res);
  } catch (e) {
      console.error("SSE Message Error:", e);
      res.status(500).send("Internal Error");
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Chess MCP Server listening on port ${port}`);
  console.log(`OpenAI Endpoint: http://localhost:${port}/mcp`);
  console.log(`SSE Endpoint:    http://localhost:${port}/sse`);
});