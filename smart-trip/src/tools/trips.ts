import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSupabase } from '../supabase.js';
import {
  listTripsShape,
  getTripShape,
  createTripShape,
  updateTripShape,
  deleteTripShape,
  cloneTripShape,
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

function newDayId() {
  return `day-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function newStopId() {
  return `stop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Shift YYYY-MM-DD by offsetMs (UTC-anchored to avoid local-TZ drift). */
function shiftDate(ymd: string, offsetMs: number): string {
  const t = new Date(`${ymd}T00:00:00Z`).getTime() + offsetMs;
  return new Date(t).toISOString().slice(0, 10);
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
    'clone_trip',
    'Duplicate a trip with all its days and stops shifted by (new_start_date - source.start_date). Stops_data is deep-copied with fresh stop ids; days_v2 rows are NEW (different ids), so the clone is independent of the source. Fails if the user already has any days_v2 row on the new dates (UNIQUE constraint on user_id+date).',
    cloneTripShape,
    async ({ source_trip_id, new_title, new_start_date, new_thumb }) => {
      const { sb, userId } = getSupabase();

      // 1) Load source trip
      const { data: src, error: srcErr } = await sb
        .from('trips')
        .select('id, title, thumb, start_date, end_date, settings')
        .eq('id', source_trip_id)
        .eq('user_id', userId)
        .is('trip_data', null)
        .maybeSingle();

      if (srcErr) return fail(`clone_trip error (source): ${srcErr.message}`);
      if (!src) return fail(`clone_trip: source trip not found: ${source_trip_id}`);

      // 2) Load source days via trip_days
      const { data: links, error: linkErr } = await sb
        .from('trip_days')
        .select('day_id, days_v2(id, date, title, color, stops_data)')
        .eq('trip_id', source_trip_id);

      if (linkErr) return fail(`clone_trip error (trip_days): ${linkErr.message}`);

      const sourceDays = (links ?? [])
        .map((row: any) => row.days_v2)
        .filter(Boolean)
        .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));

      // 3) Compute offset and shifted dates
      const offsetMs =
        new Date(`${new_start_date}T00:00:00Z`).getTime() -
        new Date(`${src.start_date}T00:00:00Z`).getTime();

      if (Number.isNaN(offsetMs)) {
        return fail(`clone_trip: invalid date format. source.start_date=${src.start_date}, new_start_date=${new_start_date}`);
      }

      const newDays = sourceDays.map((d: any) => ({
        old_id: d.id,
        new_id: newDayId(),
        new_date: shiftDate(d.date, offsetMs),
        title: d.title,
        color: d.color,
        stops_data: Array.isArray(d.stops_data)
          ? d.stops_data.map((s: any) => ({ ...s, id: newStopId() }))
          : [],
      }));

      // 4) Pre-check date conflicts on days_v2 (UNIQUE user_id+date)
      if (newDays.length > 0) {
        const { data: conflicts, error: conflictErr } = await sb
          .from('days_v2')
          .select('id, date')
          .eq('user_id', userId)
          .in('date', newDays.map((d) => d.new_date));

        if (conflictErr) return fail(`clone_trip error (conflict check): ${conflictErr.message}`);
        if (conflicts && conflicts.length > 0) {
          return fail(
            `clone_trip: target dates already have days_v2 rows (UNIQUE user_id+date). Conflicts: ${JSON.stringify(
              conflicts,
            )}. Pick a different new_start_date.`,
          );
        }
      }

      // 5) Insert new trip
      const newTrip = {
        id: newTripId(),
        user_id: userId,
        title: new_title,
        thumb: new_thumb ?? src.thumb,
        start_date: new_start_date,
        end_date: shiftDate(src.end_date, offsetMs),
        settings: src.settings ?? {},
      };

      const { data: tripRow, error: tripInsErr } = await sb
        .from('trips')
        .insert(newTrip)
        .select()
        .single();

      if (tripInsErr) return fail(`clone_trip error (trip insert): ${tripInsErr.message}`);

      // 6) Insert new days_v2 rows (batch)
      if (newDays.length > 0) {
        const dayRows = newDays.map((d) => ({
          id: d.new_id,
          user_id: userId,
          date: d.new_date,
          title: d.title,
          color: d.color ?? '#5b7a99',
          stops_data: d.stops_data,
        }));

        const { error: dayInsErr } = await sb.from('days_v2').insert(dayRows);
        if (dayInsErr) {
          // Compensation: delete the trip we just created
          await sb.from('trips').delete().eq('id', newTrip.id).eq('user_id', userId);
          return fail(`clone_trip error (days insert): ${dayInsErr.message}`);
        }

        // 7) Link new days to new trip
        const linkRows = newDays.map((d) => ({ trip_id: newTrip.id, day_id: d.new_id }));
        const { error: linkInsErr } = await sb.from('trip_days').insert(linkRows);
        if (linkInsErr) {
          // Compensation: delete days then trip
          await sb
            .from('days_v2')
            .delete()
            .in(
              'id',
              newDays.map((d) => d.new_id),
            )
            .eq('user_id', userId);
          await sb.from('trips').delete().eq('id', newTrip.id).eq('user_id', userId);
          return fail(`clone_trip error (links): ${linkInsErr.message}`);
        }
      }

      return ok(
        JSON.stringify(
          {
            cloned_trip: tripRow,
            source_trip_id,
            offset_days: Math.round(offsetMs / 86400000),
            days_cloned: newDays.length,
            day_id_map: newDays.map((d) => ({ from: d.old_id, to: d.new_id, date: d.new_date })),
          },
          null,
          2,
        ),
      );
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
