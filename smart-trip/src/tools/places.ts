import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSupabase } from '../supabase.js';
import { searchPlacesShape } from '../schemas.js';

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export function registerPlaceTools(server: McpServer) {
  server.tool(
    'search_places',
    'Fuzzy search the global places cache table by name or address (ILIKE). Returns top N results.',
    searchPlacesShape,
    async ({ query, limit }) => {
      const { sb } = getSupabase();
      const pat = `%${query}%`;

      const { data, error } = await sb
        .from('places')
        .select('place_id, name, address, lat, lng, category, photo_url, rating')
        .or(`name.ilike.${pat},address.ilike.${pat}`)
        .limit(limit ?? 10);

      if (error) return fail(`search_places error: ${error.message}`);
      return ok(JSON.stringify(data ?? [], null, 2));
    },
  );
}
