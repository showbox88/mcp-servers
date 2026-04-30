import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSupabase } from '../supabase.js';
import {
  listTripsShape,
  getTripShape,
  createTripShape,
  updateTripShape,
  deleteTripShape,
} from '../schemas.js';

const DEFAULT_TRIP_THUMB =
  'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80';

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function newTripId() {
  return `trip-${Date.now()}`;
}

export function registerTripTools(server: McpServer) {
  server.tool(
    'list_trips',
    'List all v2 trips for the configured user, sorted by creation desc. Excludes legacy v1 trips (those with trip_data set).',
    listTripsShape,
    async () => {
      const { sb, userId } = getSupabase();
      const { data, error } = await sb
        .from('trips')
        .select('id, title, thumb, start_date, end_date, settings, share_token, created_at')
        .eq('user_id', userId)
        .is('trip_data', null)
        .order('created_at', { ascending: false });

      if (error) return fail(`list_trips error: ${error.message}`);
      return ok(JSON.stringify(data ?? [], null, 2));
    },
  );

  server.tool(
    'get_trip',
    'Get one trip with all its days (days_v2 rows) and the stops_data array on each day.',
    getTripShape,
    async ({ trip_id }) => {
      const { sb, userId } = getSupabase();

      const { data: trip, error: tripErr } = await sb
        .from('trips')
        .select('id, title, thumb, start_date, end_date, settings, share_token, created_at')
        .eq('id', trip_id)
        .eq('user_id', userId)
        .is('trip_data', null)
        .maybeSingle();

      if (tripErr) return fail(`get_trip error (trip): ${tripErr.message}`);
      if (!trip) return fail(`Trip not found: ${trip_id}`);

      const { data: links, error: linkErr } = await sb
        .from('trip_days')
        .select('day_id, days_v2(id, date, title, color, stops_data, created_at)')
        .eq('trip_id', trip_id);

      if (linkErr) return fail(`get_trip error (trip_days): ${linkErr.message}`);

      const days = (links ?? [])
        .map((row: any) => row.days_v2)
        .filter(Boolean)
        .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));

      return ok(JSON.stringify({ ...trip, days }, null, 2));
    },
  );

  server.tool(
    'create_trip',
    'Create a new trip. Returns the inserted row. Does NOT auto-create days — call add_day_to_trip per day.',
    createTripShape,
    async ({ title, start_date, end_date, thumb }) => {
      const { sb, userId } = getSupabase();
      const row = {
        id: newTripId(),
        user_id: userId,
        title,
        thumb: thumb ?? DEFAULT_TRIP_THUMB,
        start_date,
        end_date,
        settings: {},
      };

      const { data, error } = await sb.from('trips').insert(row).select().single();
      if (error) return fail(`create_trip error: ${error.message}`);
      return ok(JSON.stringify(data, null, 2));
    },
  );

  server.tool(
    'update_trip',
    'Update trip metadata (title / dates / thumb / settings). Provide only the fields you want to change.',
    updateTripShape,
    async ({ trip_id, ...updates }) => {
      const { sb, userId } = getSupabase();
      const dbUpdates: Record<string, unknown> = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.start_date !== undefined) dbUpdates.start_date = updates.start_date;
      if (updates.end_date !== undefined) dbUpdates.end_date = updates.end_date;
      if (updates.thumb !== undefined) dbUpdates.thumb = updates.thumb;
      if (updates.settings !== undefined) dbUpdates.settings = updates.settings;

      if (Object.keys(dbUpdates).length === 0) {
        return fail('update_trip: no fields provided to update');
      }

      const { data, error } = await sb
        .from('trips')
        .update(dbUpdates)
        .eq('id', trip_id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) return fail(`update_trip error: ${error.message}`);
      return ok(JSON.stringify(data, null, 2));
    },
  );

  server.tool(
    'delete_trip',
    'Delete a trip. trip_days links cascade automatically; days_v2 rows are NOT deleted (they may still be referenced by other trips).',
    deleteTripShape,
    async ({ trip_id }) => {
      const { sb, userId } = getSupabase();
      const { error } = await sb
        .from('trips')
        .delete()
        .eq('id', trip_id)
        .eq('user_id', userId);

      if (error) return fail(`delete_trip error: ${error.message}`);
      return ok(`Deleted trip ${trip_id}`);
    },
  );
}
