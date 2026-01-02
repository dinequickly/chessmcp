import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { exec } from 'child_process';
import { promisify } from 'util';
import { PUZZLES } from './puzzles.js';

const execAsync = promisify(exec);

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
    return games.get(sessionId)!
}

async function getPlayerStats(username: string): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    try {
        const url = `https://api.chess.com/pub/player/${username}/games/${year}/${month}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ChessMcpServer/1.0)'
            }
        });

        const games = response.data.games;
        if (!games || games.length === 0) {
            return `No games found for ${username} in ${year}/${month}.`;
        }

        let wins = 0;
        let losses = 0;
        let draws = 0;

        games.forEach((game: any) => {
            const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
            const player = isWhite ? game.white : game.black;
            const result = player.result;

            if (result === 'win') {
                wins++;
            } else if (['checkmated', 'resigned', 'timeout', 'abandoned', 'kingofthehill', 'threecheck', 'timevsinsufficient', 'busted'].includes(result)) {
                losses++;
            } else {
                draws++;
            }
        });

        return `Recent games for ${username} (${year}/${month}):\n- Total Games: ${games.length}\n- Wins: ${wins}\n- Losses: ${losses}\n- Draws: ${draws}`;

    } catch (error: any) {
        return `Error fetching games for ${username}: ${error.message}`;
    }
}

// Helper to get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Embedded Widget HTML: Just an iframe to the main app
const widgetHtml = `<!DOCTYPE html>
<html lang="en" style="height: 100%; margin: 0;">
<head>
    <meta charset="utf-8" />
    <title>Chess App</title>
    <style>body { margin: 0; height: 100%; overflow: hidden; }</style>
</head>
<body>
    <iframe src="https://chessmcp-production.up.railway.app/" style="width: 100%; height: 100%; border: none;"></iframe>
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
      },
      {
        name: "get_player_stats",
        description: "Get a breakdown of recent games for a Chess.com user.",
        inputSchema: {
          type: "object",
          properties: {
            username: {
              type: "string",
              description: "The Chess.com username."
            }
          },
          required: ["username"]
        }
      },
      {
        name: "get_puzzle",
        description: "Get a chess puzzle to solve. Can specify a target rating.",
        inputSchema: {
          type: "object",
          properties: {
            rating: {
              type: "number",
              description: "Target Elo rating for the puzzle (e.g., 1200, 2000). If omitted, gets the Daily Puzzle or a random one."
            }
          }
        },
        // @ts-ignore
        _meta: {
            "openai/outputTemplate": "ui://widget/chess.html",
            "openai/toolInvocation/invoking": "Loading puzzle...",
            "openai/toolInvocation/invoked": "Puzzle loaded",
        }
      },
      {
        name: "analyze_last_move",
        description: "Analyze the last move played on the board using the NAKSTStudio/chess-gemma-commentary model.",
        inputSchema: {
          type: "object",
          properties: {}
        },
        // @ts-ignore
        _meta: {
            "openai/outputTemplate": "ui://widget/chess.html",
            "openai/toolInvocation/invoking": "Analyzing move...",
            "openai/toolInvocation/invoked": "Analysis complete",
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

    case "get_player_stats": {
      const schema = z.object({ username: z.string() });
      const parsed = schema.safeParse(args);
      if (!parsed.success) throw new McpError(ErrorCode.InvalidParams, "Invalid arguments");

      const stats = await getPlayerStats(parsed.data.username);
      return makeResponse(stats);
    }

    case "get_puzzle": {
      // @ts-ignore
      const targetRating = args?.rating as number | undefined;
      let puzzle;

      if (targetRating) {
          // Find closest puzzle in local DB
          puzzle = PUZZLES.reduce((prev, curr) => {
              return (Math.abs(curr.rating - targetRating) < Math.abs(prev.rating - targetRating) ? curr : prev);
          });
      } else {
          // Default to random local puzzle for simplicity and reliability
          puzzle = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
      }
      
      if (puzzle) {
           chess.load(puzzle.fen);
           const turn = chess.turn() === 'w' ? 'White' : 'Black';
           return makeResponse(`Puzzle Loaded (Rating: ${puzzle.rating}). ${turn} to move. Solution hidden.`, false);
      } else {
           return makeResponse("Failed to load puzzle.", true);
      }
    }

    case "analyze_last_move": {
        const history = chess.history({ verbose: true });
        if (history.length === 0) {
            return makeResponse("No moves have been made yet to analyze.", true);
        }
        const lastMove = history[history.length - 1];

        try {
             // 1. Get evaluation for current position (After move)
            const fenAfter = chess.fen();
            const evalAfterRes = await axios.post("https://chess-api.com/v1", { fen: fenAfter, depth: 10 });
            // Handle mate or int
            const evalAfterVal = typeof evalAfterRes.data.eval === 'number' ? evalAfterRes.data.eval : 0; 

            // 2. Get evaluation for position BEFORE move
            chess.undo();
            const fenBefore = chess.fen();
            const evalBeforeRes = await axios.post("https://chess-api.com/v1", { fen: fenBefore, depth: 10 });
            const evalBeforeVal = typeof evalBeforeRes.data.eval === 'number' ? evalBeforeRes.data.eval : 0;
            const bestMoveBefore = evalBeforeRes.data.move || "unknown";
            
            // Replay the move
            chess.move(lastMove.san);

            // 3. Calculate metrics
            const cpBefore = Math.round(evalBeforeVal * 100);
            const cpAfter = Math.round(evalAfterVal * 100);
            const delta = cpAfter - cpBefore;
            const cpString = `${cpBefore}->${cpAfter} (D=${delta})`;

            // Tag Logic
            let tag = "Good";
            if (lastMove.san === bestMoveBefore || (lastMove.lan && lastMove.lan === bestMoveBefore)) {
                tag = "Best";
            } else {
                 // Simple heuristic
                 const diff = Math.abs(delta);
                 if (diff > 50) tag = "Inaccuracy";
                 if (diff > 150) tag = "Mistake";
                 if (diff > 300) tag = "Blunder";
            }
            
            // 4. Call Python Script
            // We assume the script is in ../scripts from dist/, or we try to locate it relative to project root.
            // __dirname in src/index.ts (if running via ts-node) is src/. If compiled to dist/, it is dist/.
            // Safe bet: resolve from process.cwd() if possible, or relative.
            // Let's assume process.cwd() is project root.
            const scriptPath = path.resolve(process.cwd(), "scripts/chess_commentary.py");
            const venvPython = path.resolve(process.cwd(), "scripts/.venv/bin/python");
            
            // Fallback to system python if venv not found (though we created it)
            const pythonExec = fs.existsSync(venvPython) ? venvPython : "python3";
            
            const cmd = `"${pythonExec}" "${scriptPath}" --fen "${fenBefore}" --move "${lastMove.san}" --side "${lastMove.color === 'w' ? 'White' : 'Black'}" --tag "${tag}" --best_alt "${bestMoveBefore}" --cp "${cpString}"`;
            
            // console.log("Running analysis:", cmd);
            const { stdout, stderr } = await execAsync(cmd);
            if (stderr && !stdout) console.error("Python Stderr:", stderr); // Only log if no stdout, or log as warning
            
            return makeResponse(stdout.trim());

        } catch (e: any) {
            return makeResponse(`Analysis failed: ${e.message}`, true);
        }
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

// Serve Static Web App
const webDistPath = path.join(__dirname, '../web/out');
console.log("DEBUG: Resolved webDistPath:", webDistPath);

if (fs.existsSync(webDistPath)) {
    console.log("DEBUG: Web build directory found.");
    try {
        const files = fs.readdirSync(webDistPath);
        console.log("DEBUG: Files in web build:", files.slice(0, 5));
    } catch (e) {
        console.error("DEBUG: Error reading web dir:", e);
    }
    app.use(express.static(webDistPath));
} else {
    console.warn("DEBUG: Web build NOT found at:", webDistPath);
    console.log("DEBUG: Current __dirname:", __dirname);
    try {
        console.log("DEBUG: Parent dir content:", fs.readdirSync(path.join(__dirname, '..')));
    } catch (e) {}
}

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
        } else if (name === "get_player_stats") {
            const stats = await getPlayerStats(args.username);
            result = { content: stats };
        } else if (name === "get_puzzle") {
             const targetRating = args?.rating;
             let puzzle;
             if (targetRating) {
                 puzzle = PUZZLES.reduce((prev, curr) => (Math.abs(curr.rating - targetRating) < Math.abs(prev.rating - targetRating) ? curr : prev));
             } else {
                 puzzle = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
             }
             if (puzzle) {
                 chess.load(puzzle.fen);
                 result = { content: `Puzzle Loaded (Rating: ${puzzle.rating})` };
             } else {
                 result = { error: "Failed to load puzzle" };
             }
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
        console.log("MCP ReadResource:", request.params.uri);
        if (request.params.uri === "chess://board") {
            return { contents: [{ uri: "chess://board", mimeType: "text/plain", text: chess.ascii() + "\n\nFEN: " + chess.fen() }] };
        }
        if (request.params.uri === "ui://widget/chess.html") {
            console.log("Serving embedded widget HTML");
            return { contents: [{ uri: "ui://widget/chess.html", mimeType: "text/html", text: widgetHtml }] };
        }
        console.error("Resource not found:", request.params.uri);
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
                },
                {
                    name: "get_player_stats",
                    description: "Get a breakdown of recent games for a Chess.com user.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            username: { type: "string", description: "The Chess.com username." }
                        },
                        required: ["username"]
                    }
                },
                {
                    name: "get_puzzle",
                    description: "Get a chess puzzle to solve. Can specify a target rating.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            rating: { type: "number", description: "Target Elo rating for the puzzle (e.g., 1200, 2000). If omitted, gets the Daily Puzzle or a random one." }
                        }
                    },
                    // @ts-ignore
                    _meta: {
                        "openai/outputTemplate": "ui://widget/chess.html",
                        "openai/toolInvocation/invoking": "Loading puzzle...",
                        "openai/toolInvocation/invoked": "Puzzle loaded",
                    }
                },
                {
                    name: "analyze_last_move",
                    description: "Analyze the last move played on the board using the NAKSTStudio/chess-gemma-commentary model.",
                    inputSchema: { type: "object", properties: {} },
                    // @ts-ignore
                    _meta: {
                        "openai/outputTemplate": "ui://widget/chess.html",
                        "openai/toolInvocation/invoking": "Analyzing move...",
                        "openai/toolInvocation/invoked": "Analysis complete",
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
        if (name === "get_player_stats") {
            // @ts-ignore
            const username = args?.username as string;
            if (!username) return makeResponse("Username is required", true);
            const stats = await getPlayerStats(username);
            return makeResponse(stats);
        }
        if (name === "get_puzzle") {
            // @ts-ignore
            const targetRating = args?.rating as number | undefined;
            let puzzle;
            if (targetRating) {
                puzzle = PUZZLES.reduce((prev, curr) => (Math.abs(curr.rating - targetRating) < Math.abs(prev.rating - targetRating) ? curr : prev));
            } else {
                puzzle = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
            }
            if (puzzle) {
                chess.load(puzzle.fen);
                const turn = chess.turn() === 'w' ? 'White' : 'Black';
                return makeResponse(`Puzzle Loaded (Rating: ${puzzle.rating}). ${turn} to move. Solution hidden.`, false);
            } else {
                return makeResponse("Failed to load puzzle.", true);
            }
        }
        if (name === "analyze_last_move") {
            const history = chess.history({ verbose: true });
            if (history.length === 0) return makeResponse("No moves to analyze.", true);
            const lastMove = history[history.length - 1];

            try {
                // 1. Eval After
                const fenAfter = chess.fen();
                const evalAfterRes = await axios.post("https://chess-api.com/v1", { fen: fenAfter, depth: 10 });
                const evalAfterVal = typeof evalAfterRes.data.eval === 'number' ? evalAfterRes.data.eval : 0;

                // 2. Eval Before
                chess.undo();
                const fenBefore = chess.fen();
                const evalBeforeRes = await axios.post("https://chess-api.com/v1", { fen: fenBefore, depth: 10 });
                const evalBeforeVal = typeof evalBeforeRes.data.eval === 'number' ? evalBeforeRes.data.eval : 0;
                const bestMoveBefore = evalBeforeRes.data.move || "unknown";
                chess.move(lastMove.san);

                // 3. Metrics
                const cpBefore = Math.round(evalBeforeVal * 100);
                const cpAfter = Math.round(evalAfterVal * 100);
                const delta = cpAfter - cpBefore;
                const cpString = `${cpBefore}->${cpAfter} (D=${delta})`;

                let tag = "Good";
                if (lastMove.san === bestMoveBefore || (lastMove.lan && lastMove.lan === bestMoveBefore)) {
                    tag = "Best";
                } else {
                    const diff = Math.abs(delta);
                    if (diff > 50) tag = "Inaccuracy";
                    if (diff > 150) tag = "Mistake";
                    if (diff > 300) tag = "Blunder";
                }

                // 4. Python
                const scriptPath = path.resolve(process.cwd(), "scripts/chess_commentary.py");
                const venvPython = path.resolve(process.cwd(), "scripts/.venv/bin/python");
                const pythonExec = fs.existsSync(venvPython) ? venvPython : "python3";
                
                const cmd = `"${pythonExec}" "${scriptPath}" --fen "${fenBefore}" --move "${lastMove.san}" --side "${lastMove.color === 'w' ? 'White' : 'Black'}" --tag "${tag}" --best_alt "${bestMoveBefore}" --cp "${cpString}"`;
                
                const { stdout } = await execAsync(cmd);
                return makeResponse(stdout.trim());
            } catch (e: any) {
                return makeResponse(`Analysis failed: ${e.message}`, true);
            }
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
    // FORCE "default" so the Agent and the Web UI share the same board
    const sessionId = "default"; 

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

app.post("/messages", async (req, res) => { // Do NOT apply express.json() here for MCP SDK
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

if (process.argv.includes("--stdio")) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
} else {
    const port = process.env.PORT || 3000;
    console.log(`DEBUG: Starting server on port ${port}...`);
    app.listen(Number(port), "0.0.0.0", () => {
      console.log(`Chess MCP Server listening on port ${port}`);
      console.log(`OpenAI Endpoint: http://localhost:${port}/mcp`);
      console.log(`SSE Endpoint:    http://localhost:${port}/sse`);
    });
}