import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTripTools } from './tools/trips.js';
import { registerDayTools } from './tools/days.js';
import { registerStopTools } from './tools/stops.js';
import { registerPlaceTools } from './tools/places.js';
import { registerMusicTools } from './tools/music.js';

/**
 * Build a fresh McpServer with all 15 smart-trip tools registered.
 *
 * Used by both transports:
 *   - dist/index.js  (stdio, local dev / smoke test)
 *   - dist/server.js (HTTP, deployed behind Tailscale Funnel)
 *
 * In stateless HTTP mode we build a new server PER REQUEST, so this
 * must stay cheap — no I/O at construction time.
 */
export function setupServer(): McpServer {
  const server = new McpServer({
    name: 'smart-trip',
    version: '0.1.0',
  });

  registerTripTools(server);
  registerDayTools(server);
  registerStopTools(server);
  registerPlaceTools(server);
  registerMusicTools(server);

  return server;
}
