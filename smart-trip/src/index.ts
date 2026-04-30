#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTripTools } from './tools/trips.js';
import { registerDayTools } from './tools/days.js';
import { registerStopTools } from './tools/stops.js';
import { registerPlaceTools } from './tools/places.js';

// Load .env from package root (one level above dist/), so `node dist/index.js` works regardless of cwd
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '..', '.env') });

const server = new McpServer({
  name: 'smart-trip',
  version: '0.1.0',
});

registerTripTools(server);
registerDayTools(server);
registerStopTools(server);
registerPlaceTools(server);

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
