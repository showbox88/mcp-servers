import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSupabase } from '../supabase.js';
import { addStopShape, updateStopShape, removeStopShape } from '../schemas.js';

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

async function loadStops(day_id: string): Promise<{ stops: any[] | null; error?: string }> {
  const { sb, userId } = getSupabase();
  const { data, error } = await sb
    .from('days_v2')
    .select('stops_data')
    .eq('id', day_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return { stops: null, error: error.message };
  if (!data) return { stops: null, error: `Day not found: ${day_id}` };

  const stops = Array.isArray(data.stops_data) ? [...data.stops_data] : [];
  return { stops };
}

async function writeStops(day_id: string, stops: any[]): Promise<string | null> {
  const { sb, userId } = getSupabase();
  const { error } = await sb
    .from('days_v2')
    .update({ stops_data: stops })
    .eq('id', day_id)
    .eq('user_id', userId);
  return error ? error.message : null;
}

export function registerStopTools(server: McpServer) {
  server.tool(
    'add_stop',
    'Append a stop to days_v2.stops_data JSONB array. The stop is read-modify-written — single-user-only safe.',
    addStopShape,
    async ({ day_id, stop }) => {
      const { stops, error } = await loadStops(day_id);
      if (!stops) return fail(`add_stop: ${error}`);

      const newStop = {
        id: stop.id ?? `stop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...stop,
      };
      stops.push(newStop);

      const writeErr = await writeStops(day_id, stops);
      if (writeErr) return fail(`add_stop write error: ${writeErr}`);

      return ok(JSON.stringify({ added: newStop, total_stops: stops.length }, null, 2));
    },
  );

  server.tool(
    'update_stop',
    'Modify a stop in place at the given index. Provide partial fields.',
    updateStopShape,
    async ({ day_id, stop_index, fields }) => {
      const { stops, error } = await loadStops(day_id);
      if (!stops) return fail(`update_stop: ${error}`);

      if (stop_index < 0 || stop_index >= stops.length) {
        return fail(`update_stop: stop_index ${stop_index} out of range (0..${stops.length - 1})`);
      }

      stops[stop_index] = { ...stops[stop_index], ...fields };

      const writeErr = await writeStops(day_id, stops);
      if (writeErr) return fail(`update_stop write error: ${writeErr}`);

      return ok(JSON.stringify({ updated: stops[stop_index], stop_index }, null, 2));
    },
  );

  server.tool(
    'remove_stop',
    'Splice the stop at the given index out of stops_data.',
    removeStopShape,
    async ({ day_id, stop_index }) => {
      const { stops, error } = await loadStops(day_id);
      if (!stops) return fail(`remove_stop: ${error}`);

      if (stop_index < 0 || stop_index >= stops.length) {
        return fail(`remove_stop: stop_index ${stop_index} out of range (0..${stops.length - 1})`);
      }

      const [removed] = stops.splice(stop_index, 1);

      const writeErr = await writeStops(day_id, stops);
      if (writeErr) return fail(`remove_stop write error: ${writeErr}`);

      return ok(JSON.stringify({ removed, total_stops: stops.length }, null, 2));
    },
  );
}
