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
    return games.get(sessionId)!;
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

function createChessServer(sessionId: string) {
    const chess = getGame(sessionId);
    const srv = new Server({ name: "mcp-chess-server", version: "1.0.0" }, { capabilities: { resources: {}, tools: {} } });

    srv.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
            { uri: "chess://board", name: "Board", mimeType: "text/plain" },
            { uri: "ui://widget/chess.html", name: "Widget", mimeType: "text/html" }
        ]
    }));

    srv.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        if (request.params.uri === "chess://board") return { contents: [{ uri: "chess://board", mimeType: "text/plain", text: chess.fen() }] };
        if (request.params.uri === "ui://widget/chess.html") return { contents: [{ uri: "ui://widget/chess.html", mimeType: "text/html", text: widgetHtml }] };
        throw new McpError(ErrorCode.InvalidRequest, "Resource not found");
    });

    srv.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "move_piece",
                description: "Make a move.",
                inputSchema: { type: "object", properties: { move: { type: "string" } }, required: ["move"] },
                // @ts-ignore
                _meta: { "openai/outputTemplate": "ui://widget/chess.html" }
            },
            {
                name: "get_stockfish_move",
                description: "AI move.",
                inputSchema: { type: "object", properties: {} },
                // @ts-ignore
                _meta: { "openai/outputTemplate": "ui://widget/chess.html" }
            },
            {
                name: "new_game",
                description: "Reset game.",
                inputSchema: { type: "object", properties: { opening: { type: "string" } } },
                // @ts-ignore
                _meta: { "openai/outputTemplate": "ui://widget/chess.html" }
            },
            {
                name: "get_puzzle",
                description: "Get puzzle.",
                inputSchema: { type: "object", properties: { rating: { type: "number" } } },
                // @ts-ignore
                _meta: { "openai/outputTemplate": "ui://widget/chess.html" }
            }
        ]
    }));

    srv.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const makeRes = (d: any) => ({ content: [{ type: "text", text: JSON.stringify(d) }] });

        if (name === "move_piece") {
            const m = (args as any).move;
            if (!chess.move(m)) return makeRes({ error: "Invalid" });
            return makeRes({ status: "ok", move: m, fen: chess.fen() });
        }
        if (name === "get_stockfish_move") {
             const response = await axios.post("https://chess-api.com/v1", { fen: chess.fen(), depth: 10 });
             chess.move(response.data.move);
             return makeRes({ status: "ok", move: response.data.move, fen: chess.fen() });
        }
        if (name === "new_game") {
            chess.reset();
            return makeRes({ status: "ok", fen: chess.fen() });
        }
        if (name === "get_puzzle") {
            const r = (args as any).rating;
            const puzzle = r ? PUZZLES.reduce((prev, curr) => (Math.abs(curr.rating - r) < Math.abs(prev.rating - r) ? curr : prev)) : PUZZLES[0];
            chess.load(puzzle.fen);
            return makeRes({ status: "ok", id: puzzle.id, rating: puzzle.rating, fen: puzzle.fen, solution: puzzle.moves });
        }
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
    });

    return srv;
}

// --- Express Server Setup ---

const app = express();
app.use(cors({ origin: '*' }));

// Serve Static Web App
const webDistPath = path.join(__dirname, '../web/out');
if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
}

app.get("/api/board", (req, res) => {
    const chess = getGame("default");
    res.json({ fen: chess.fen(), turn: chess.turn() });
});

app.post("/api/tools/run", express.json(), async (req, res) => {
    const { name, args } = req.body;
    const chess = getGame("default");
    try {
        if (name === "move_piece") chess.move(args.move);
        else if (name === "new_game") chess.reset();
        res.json({ status: "ok" });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Handle POST (Actual MCP Traffic)
app.post("/mcp", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const serverInstance = createChessServer("default");
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
        await serverInstance.connect(transport);
        await transport.handleRequest(req, res);
    } catch (error) {
        if (!res.headersSent) res.status(500).send("Internal Server Error");
    } finally { serverInstance.close(); }
});

// OpenAI Domain Verification
app.get("/.well-known/openai-apps-challenge", (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send("dBk_khd9ye-ES-xhPdLFd_HTwvPKN_vKL4ejFSrqzEk");
});

const port = process.env.PORT || 3000;
app.listen(Number(port), "0.0.0.0", () => {
  console.log(`Chess MCP Server listening on port ${port}`);
});