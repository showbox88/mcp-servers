#!/usr/bin/env node
/**
 * HTTP entry — exposes smart-trip MCP via Streamable HTTP transport.
 *
 * Designed to run inside a Linux VM at the office, fronted by Tailscale
 * Funnel which terminates TLS and gives us a public *.ts.net URL.
 *
 * - Binds to 127.0.0.1 only — Funnel reaches in via localhost.
 * - Stateless mode: each POST /mcp creates a fresh McpServer + transport,
 *   handles one request, closes. No session affinity needed; works fine
 *   for our tool-call workload (no streaming, no notifications).
 * - Bearer token auth: single shared secret in MCP_BEARER_TOKEN env.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { existsSync } from 'node:fs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { setupServer } from './setupServer.js';
import { bearerAuth } from './auth.js';

// Load .env from package root (one level above dist/)
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '..', '.env') });

const PORT = Number(process.env.MCP_HTTP_PORT ?? 3001);
const HOST = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
const TOKEN = process.env.MCP_BEARER_TOKEN;

if (!TOKEN || TOKEN.length < 32) {
  console.error(
    '[smart-trip-mcp] FATAL: MCP_BEARER_TOKEN must be set and at least 32 chars. Generate one with: openssl rand -hex 32',
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '4mb' }));

// Static media serving — exposes /opt/music as /audio/*.
// Used as a quick streaming endpoint for music MCP experiments. Express's
// static middleware handles HTTP Range requests automatically (essential for
// audio seek). Files are public — anyone with the URL can stream. For now
// security comes from filenames being non-guessable, not auth. Don't put
// sensitive content here.
//
// MIME types: express.static maps .mp3 → audio/mpeg from its built-in db.
//
// TODO when this graduates to its own MCP: split into a dedicated music server,
// add path-token auth, build a proper MP3 index with metadata.
const MEDIA_DIR = process.env.MCP_MEDIA_DIR ?? '/opt/music';
if (existsSync(MEDIA_DIR)) {
  app.use(
    '/audio',
    express.static(MEDIA_DIR, {
      acceptRanges: true,
      cacheControl: true,
      maxAge: '1h',
      fallthrough: false,
    }),
  );
  console.error(`[smart-trip-mcp] serving /audio from ${MEDIA_DIR}`);
}

// Health check (no auth) — handy for systemd / uptime probes.
// Tool count is computed once at startup by probing a fresh server instance.
const TOOL_COUNT = (() => {
  const probe = setupServer();
  const count = Object.keys((probe as any)._registeredTools ?? {}).length;
  probe.close().catch(() => {});
  return count;
})();
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'smart-trip-mcp', tools: TOOL_COUNT });
});

// MCP endpoint handler — runs after auth middleware
const mcpHandler = async (req: express.Request, res: express.Response) => {
  try {
    const server = setupServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    // Make sure resources are released regardless of outcome
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[smart-trip-mcp] request error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
};

// Two routes accepted (same handler, same auth):
//   POST /mcp                — token via Authorization header (Claude Code, curl)
//   POST /mcp/<token>        — token via URL path  (Claude.ai connector UI workaround)
app.post('/mcp', bearerAuth(TOKEN), mcpHandler);
app.post('/mcp/:token', bearerAuth(TOKEN), mcpHandler);

// Reject GET/DELETE /mcp explicitly (stateless mode doesn't support them)
app.all('/mcp', (_req, res) => {
  res
    .status(405)
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});
app.all('/mcp/:token', (_req, res) => {
  res
    .status(405)
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});

app.listen(PORT, HOST, () => {
  console.error(`[smart-trip-mcp] HTTP listening on ${HOST}:${PORT}`);
  console.error('[smart-trip-mcp] expose via: tailscale serve --bg --https=443 http://localhost:' + PORT);
});
