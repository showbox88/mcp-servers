#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '..', '.env') });

const server = new McpServer({
  name: 'REPLACE-ME',
  version: '0.1.0',
});

// ── Example tool: replace with your own ──────────────────────────────────
server.tool(
  'echo',
  'Echo back what you send. Replace this with real tools for your app.',
  { text: z.string().describe('Anything to echo back') },
  async ({ text }) => ({
    content: [{ type: 'text' as const, text: `You said: ${text}` }],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[REPLACE-ME-mcp] running on stdio');
}

main().catch((err) => {
  console.error('[REPLACE-ME-mcp] fatal:', err);
  process.exit(1);
});
