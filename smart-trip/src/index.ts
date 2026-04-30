#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupServer } from './setupServer.js';

// Load .env from package root (one level above dist/), so `node dist/index.js` works regardless of cwd
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '..', '.env') });

const server = setupServer();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is reserved for MCP protocol frames
  console.error('[smart-trip-mcp] running on stdio');
}

main().catch((err) => {
  console.error('[smart-trip-mcp] fatal:', err);
  process.exit(1);
});
