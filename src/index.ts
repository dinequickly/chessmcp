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

// Global State mapped by Session ID
const games = new Map<string, Chess>();

const POPULAR_OPENINGS: Record<string, string> = {
  "Ruy Lopez": "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3",
  "Sicilian Defense": "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "Queen's Gambit": "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP3PPP/RNBQKBNR b KQkq - 0 2",
  "French Defense": "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "Caro-Kann Defense": "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "Italian Game": "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3",
  "King's Indian Defense": "rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP3PPP/RNBQKBNR w KQkq - 0 3",
  "English Opening": "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1",
  "Reti Opening": "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1",
  "Slav Defense": "rnbqkbnr/pp2pppp/2p5/3p4/2PP4/8/PP3PPP/RNBQKBNR w KQkq - 0 3",
  "Nimzo-Indian Defense": "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP3PPP/RNBQKB1R w KQkq - 2 4",
  "Dutch Defense": "rnbqkbnr/ppppp1pp/8/5p2/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2"
};

function getGame(sessionId: string): Chess {
    if (!games.has(sessionId)) {
        games.set(sessionId, new Chess());
    }
    return games.get(sessionId)!;
}

// Helper to get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Embedded Widget HTML to avoid runtime file read issues
const widgetHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>Chess Board</title>
    <style>
        :root {
            --bg-dark: #779556;
            --bg-light: #ebecd0;
            --border-color: #262421;
        }
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #f6f8fb;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        main {
            width: 100%;
            max-width: 400px;
            background: #fff;
            padding: 16px;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            box-sizing: border-box;
        }
        h2 { margin: 0 0 12px; text-align: center; color: #333; }
        .board {
            display: grid;
            grid-template-columns: repeat(8, 1fr);
            grid-template-rows: repeat(8, 1fr);
            width: 100%;
            aspect-ratio: 1/1;
            border: 4px solid var(--border-color);
            box-sizing: border-box;
        }
        .square {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .square.light { background-color: var(--bg-light); }
        .square.dark { background-color: var(--bg-dark); }
        .piece {
            width: 90%;
            height: 90%;
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        }
        .coord {
            position: absolute;
            font-size: 10px;
            font-weight: bold;
            pointer-events: none;
        }
        .coord.rank { top: 2px; left: 2px; }
        .coord.file { bottom: 0px; right: 2px; }
        .light .coord { color: var(--bg-dark); }
        .dark .coord { color: var(--bg-light); }
        
        .status {
            margin-top: 12px;
            text-align: center;
            font-weight: bold;
            color: #555;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <main>
        <h2>Chess Game</h2>
        <div id="board" class="board"></div>
        <div id="status" class="status">Waiting for game data...</div>
    </main>

    <script type="module">
        // Helper to parse FEN
        function parseFen(fen) {
            const [placement, turn] = fen.split(' ');
            const rows = placement.split('/');
            const board = [];
            
            for (let r = 0; r < 8; r++) {
                const rowStr = rows[r];
                const boardRow = [];
                for (let i = 0; i < rowStr.length; i++) {
                    const char = rowStr[i];
                    if (isNaN(char)) {
                        // Piece
                        const color = char === char.toUpperCase() ? 'w' : 'b';
                        const type = char.toLowerCase();
                        boardRow.push({ type, color });
                    } else {
                        // Empty squares
                        const count = parseInt(char);
                        for (let k = 0; k < count; k++) boardRow.push(null);
                    }
                }
                board.push(boardRow);
            }
            return { board, turn };
        }

        const boardEl = document.getElementById('board');
        const statusEl = document.getElementById('status');
        
        // Initial State
        let currentFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

        function render(fen) {
            boardEl.innerHTML = '';
            const { board, turn } = parseFen(fen);
            
            statusEl.textContent = \`Turn: \${turn === 'w' ? 'White' : 'Black'}\`;

            board.forEach((row, r) => {
                row.forEach((piece, c) => {
                    const square = document.createElement('div');
                    const isDark = (r + c) % 2 === 1;
                    square.className = \`square \${isDark ? 'dark' : 'light'}\`;
                    
                    // Coordinates
                    if (c === 0) {
                        const coord = document.createElement('span');
                        coord.className = 'coord rank';
                        coord.textContent = 8 - r;
                        square.appendChild(coord);
                    }
                    if (r === 7) {
                        const coord = document.createElement('span');
                        coord.className = 'coord file';
                        coord.textContent = String.fromCharCode(97 + c);
                        square.appendChild(coord);
                    }

                    if (piece) {
                        const pieceDiv = document.createElement('div');
                        pieceDiv.className = 'piece';
                        // Using the same reliable CDN as the React app
                        const imgUrl = \`https://images.chesscomfiles.com/chess-themes/pieces/neo/150/\${piece.color}\${piece.type}.png\`;
                        pieceDiv.style.backgroundImage = \`url('\${imgUrl}')\`;
                        square.appendChild(pieceDiv);
                    }

                    boardEl.appendChild(square);
                });
            });
        }

        // --- Apps SDK Integration ---

        const updateState = (data) => {
             // Look for FEN in structured content or globals
             if (data?.fen) {
                 currentFen = data.fen;
                 render(currentFen);
             } else if (data?.structuredContent?.fen) {
                 currentFen = data.structuredContent.fen;
                 render(currentFen);
             }
        };

        // 1. Initial Render
        if (window.openai?.toolOutput) {
            updateState(window.openai.toolOutput);
        } else {
            render(currentFen);
        }

        // 2. Listen for globals updates (when tools are called)
        window.addEventListener("openai:set_globals", (event) => {
            const globals = event.detail?.globals;
            if (globals?.toolOutput) {
                updateState(globals.toolOutput);
            }
        });

    </script>
</body>
</html>`;

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

// --- MCP Handlers (Global/Default Session for SSE/Debug) ---
// Note: These handlers use a default session for simplicity if accessed directly via the global 'server' instance (e.g. SSE).
// The per-request 'createChessServer' below handles the actual multi-tenant traffic.

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
  const chess = getGame("default");
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
        description: "Reset the chess board for a new game, optionally starting with a popular opening.",
        inputSchema: {
          type: "object",
          properties: {
             opening: {
                 type: "string",
                 description: "Optional name of a popular opening (e.g., 'Sicilian Defense'). Use list_openings to see available options."
             }
          },
        },
        // @ts-ignore
        _meta: {
             "openai/outputTemplate": "ui://widget/chess.html",
             "openai/toolInvocation/invoking": "Resetting board...",
             "openai/toolInvocation/invoked": "Board reset",
        }
      },
      {
          name: "list_openings",
          description: "List available popular chess openings that can be used with new_game.",
          inputSchema: {
              type: "object",
              properties: {}
          }
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const chess = getGame("default");
  
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
      // @ts-ignore
      const opening = args?.opening as string | undefined;
      if (opening) {
          if (POPULAR_OPENINGS[opening]) {
              chess.load(POPULAR_OPENINGS[opening]);
              return makeResponse(`New game started with ${opening}.`);
          } else {
              return makeResponse(`Opening '${opening}' not found. Available: ${Object.keys(POPULAR_OPENINGS).join(", ")}`, true);
          }
      }
      chess.reset();
      return makeResponse("New game started.");
    }

    case "list_openings": {
        return {
            content: [{ type: "text", text: `Available openings: ${Object.keys(POPULAR_OPENINGS).join(", ")}` }],
            isError: false
        };
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
    const chess = getGame("default");
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
    const chess = getGame("default");
    try {
        let result;
        if (name === "move_piece") {
            chess.move(args.move);
            result = { content: `Moved ${args.move}` };
        } else if (name === "new_game") {
            if (args.opening && POPULAR_OPENINGS[args.opening]) {
                chess.load(POPULAR_OPENINGS[args.opening]);
                result = { content: `Started ${args.opening}` };
            } else {
                chess.reset();
                result = { content: "Reset" };
            }
        } else if (name === "get_stockfish_move") {
             const response = await axios.post("https://chess-api.com/v1", { fen: chess.fen() });
             chess.move(response.data.move);
             result = { content: `AI Moved ${response.data.move}` };
        } else if (name === "list_openings") {
            result = { content: Object.keys(POPULAR_OPENINGS) };
        }
        res.json(result);
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

// --- OpenAI / Streamable HTTP Transport ---

// Factory function to create a fresh server instance for every request (Stateless Mode)
function createChessServer(sessionId: string) {
    const chess = getGame(sessionId);

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
                    description: "Make a move on the chess board. Accepts SAN (e.g., 'Nf3', 'e4') or UCI (e.g., 'e2e4') notation.",
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
                    description: "Ask the AI opponent (Stockfish) to make the best move.",
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
                    description: "Reset the chess board for a new game, optionally starting with a popular opening.",
                    inputSchema: { 
                        type: "object", 
                        properties: { 
                            opening: { 
                                type: "string", 
                                description: "Optional name of a popular opening (e.g., 'Sicilian Defense'). Use list_openings to see available options."
                            }
                        } 
                    },
                    // @ts-ignore
                    _meta: {
                         "openai/outputTemplate": "ui://widget/chess.html",
                         "openai/toolInvocation/invoking": "Resetting board...",
                         "openai/toolInvocation/invoked": "Board reset",
                    }
                },
                {
                    name: "list_openings",
                    description: "List available popular chess openings that can be used with new_game.",
                    inputSchema: {
                        type: "object",
                        properties: {}
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
            try {
                // @ts-ignore
                const op = args?.opening as string | undefined;
                if (op && POPULAR_OPENINGS[op]) {
                    try {
                        chess.load(POPULAR_OPENINGS[op]);
                        return makeResponse(`Started ${op}`);
                    } catch (e) {
                         console.error(`Failed to load opening ${op}:`, e);
                         throw new Error(`Failed to load opening ${op}`);
                    }
                }
                chess.reset();
                return makeResponse("Reset.");
            } catch (e: any) {
                return makeResponse(`Error starting new game: ${e.message}`, true);
            }
        }
        if (name === "list_openings") {
            return {
                content: [{ type: "text", text: Object.keys(POPULAR_OPENINGS).join(", ") }],
                isError: false
            };
        }
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
    });

    return srv;
}

// Handle GET (Health Check / Discovery)
app.get("/mcp", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send("Chess MCP Server Active");
});

// OpenAI Domain Verification Endpoint
app.get("/.well-known/openai-apps-challenge", (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send("dBk_khd9ye-ES-xhPdLFd_HTwvPKN_vKL4ejFSrqzEk");
});

// Handle POST (Actual MCP Traffic)
app.post("/mcp", async (req, res) => {
    // console.log("Received POST /mcp request"); // Debug log
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    
    // Extract Session ID from Headers (or default)
    const sessionId = (req.headers["mcp-session-id"] as string) || "default";

    // Create Fresh Server & Transport per Request (Stateless Pattern)
    const serverInstance = createChessServer(sessionId);
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

app.post("/messages", express.json(), async (req, res) => { // Apply express.json() here
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