import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSupabase } from '../supabase.js';
import {
  addStopShape,
  updateStopShape,
  removeStopShape,
  reorderStopsShape,
  addStopsBulkShape,
  setNoteEventShape,
} from '../schemas.js';

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
    [
      'Append a stop to days_v2.stops_data JSONB array.',
      '',
      '⚠️ CRITICAL: type MUST be EXACTLY one of:',
      '  "location" / "hotel_checkin" / "activity" / "note" / "list"',
      'Anything else (notably "event") will be rejected. "event" is a CONCEPT, not a type:',
      '',
      '  ❌ WRONG: { type: "event", location: "看日落" }',
      '  ✅ RIGHT: { type: "note", content: "看日落", isEvent: true }',
      '',
      'Type picking guide:',
      '  - real venue (restaurant, museum, store) with address → "location"',
      '    Set placeId/lat/lng/address if known.',
      '  - hotel arrival → "hotel_checkin"',
      '  - paid or booked service (tour, ticket, reservation, class) → "activity"',
      '  - free informal happening with no specific venue (sunset, plane ride,',
      '    feeling on the road) → "note" with isEvent=true and body in `content`',
      '  - reminder / pre-trip checklist item → "note" (leave isEvent unset, body in `content`)',
      '  - candidate group / shortlist → "list"',
      '',
      'Note body field: put text in `content`, NOT in `note` or `desc`.',
      'Smart Trip UI renders type=note ONLY from the `content` field.',
      '',
      'When unsure between event and reminder, leave isEvent unset — user toggles in UI.',
      '',
      'Read-modify-write — single-user-only safe (concurrent writes may lose updates).',
    ].join('\n'),
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

  server.tool(
    'reorder_stops',
    'Move a stop within a day from from_index to to_index. Both indices refer to the array BEFORE the move (so move first to last in 4-stop day = from=0, to=3).',
    reorderStopsShape,
    async ({ day_id, from_index, to_index }) => {
      const { stops, error } = await loadStops(day_id);
      if (!stops) return fail(`reorder_stops: ${error}`);

      if (from_index < 0 || from_index >= stops.length) {
        return fail(`reorder_stops: from_index ${from_index} out of range (0..${stops.length - 1})`);
      }
      if (to_index < 0 || to_index >= stops.length) {
        return fail(`reorder_stops: to_index ${to_index} out of range (0..${stops.length - 1})`);
      }
      if (from_index === to_index) {
        return ok(JSON.stringify({ noop: true, stops_count: stops.length }, null, 2));
      }

      const [moved] = stops.splice(from_index, 1);
      stops.splice(to_index, 0, moved);

      const writeErr = await writeStops(day_id, stops);
      if (writeErr) return fail(`reorder_stops write error: ${writeErr}`);

      return ok(
        JSON.stringify(
          { moved, from_index, to_index, order: stops.map((s: any) => s.location) },
          null,
          2,
        ),
      );
    },
  );

  server.tool(
    'add_stops_bulk',
    'Append multiple stops to a day in one call. All stops are appended in the given order; ids are auto-generated if absent. Single round-trip to Supabase.',
    addStopsBulkShape,
    async ({ day_id, stops: incoming }) => {
      const { stops, error } = await loadStops(day_id);
      if (!stops) return fail(`add_stops_bulk: ${error}`);

      const added = incoming.map((s) => ({
        id: s.id ?? `stop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...s,
      }));
      stops.push(...added);

      const writeErr = await writeStops(day_id, stops);
      if (writeErr) return fail(`add_stops_bulk write error: ${writeErr}`);

      return ok(
        JSON.stringify({ added_count: added.length, total_stops: stops.length, added }, null, 2),
      );
    },
  );

  server.tool(
    'set_note_event',
    [
      'Toggle the isEvent flag on a type=note stop.',
      '',
      'When isEvent=true, the note IS counted in Smart Trip UI as a "stop" (used for free-form',
      'events with no specific venue: sunset, beach walk, in-flight moment).',
      'When isEvent=false (or unset), it stays a reminder — visible but not counted.',
      '',
      'Errors if the stop at stop_index is not type=note.',
    ].join('\n'),
    setNoteEventShape,
    async ({ day_id, stop_index, is_event }) => {
      const { stops, error } = await loadStops(day_id);
      if (!stops) return fail(`set_note_event: ${error}`);

      if (stop_index < 0 || stop_index >= stops.length) {
        return fail(`set_note_event: stop_index ${stop_index} out of range (0..${stops.length - 1})`);
      }
      if (stops[stop_index].type !== 'note') {
        return fail(
          `set_note_event: stop at index ${stop_index} is type=${stops[stop_index].type}, only type=note supports isEvent`,
        );
      }

      stops[stop_index] = { ...stops[stop_index], isEvent: is_event };

      const writeErr = await writeStops(day_id, stops);
      if (writeErr) return fail(`set_note_event write error: ${writeErr}`);

      return ok(
        JSON.stringify(
          { day_id, stop_index, isEvent: is_event, stop: stops[stop_index] },
          null,
          2,
        ),
      );
    },
  );
}
