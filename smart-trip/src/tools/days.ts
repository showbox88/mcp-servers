import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSupabase } from '../supabase.js';
import { addDayToTripShape, updateDayShape, removeDayShape } from '../schemas.js';

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function newDayId() {
  return `day-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function registerDayTools(server: McpServer) {
  server.tool(
    'add_day_to_trip',
    'Create a new day for the user (one per date — UNIQUE on user_id+date) and link it to the given trip via trip_days. Returns { day, link } on success. Compensates by deleting the day if linking fails.',
    addDayToTripShape,
    async ({ trip_id, date, title, color }) => {
      const { sb, userId } = getSupabase();

      const dayRow = {
        id: newDayId(),
        user_id: userId,
        date,
        title: title ?? null,
        color: color ?? '#5b7a99',
        stops_data: [],
      };

      // Step 1: upsert days_v2 row (UNIQUE on user_id+date — if you call twice for same date you reuse it)
      const { data: day, error: dayErr } = await sb
        .from('days_v2')
        .upsert(dayRow, { onConflict: 'user_id,date', ignoreDuplicates: false })
        .select()
        .single();

      if (dayErr || !day) return fail(`add_day_to_trip error (days_v2): ${dayErr?.message}`);

      // Step 2: link via trip_days (idempotent — upsert ignores duplicate primary key)
      const { error: linkErr } = await sb
        .from('trip_days')
        .upsert({ trip_id, day_id: day.id });

      if (linkErr) {
        // Compensation: only roll back the day if WE just created it (not if it was pre-existing)
        const wasJustCreated = day.id === dayRow.id;
        if (wasJustCreated) {
          await sb.from('days_v2').delete().eq('id', day.id).eq('user_id', userId);
        }
        return fail(`add_day_to_trip error (trip_days): ${linkErr.message}`);
      }

      return ok(JSON.stringify({ day, linked_to: trip_id }, null, 2));
    },
  );

  server.tool(
    'update_day',
    'Update title / color / date on a days_v2 row. Provide only fields to change.',
    updateDayShape,
    async ({ day_id, ...updates }) => {
      const { sb, userId } = getSupabase();
      const dbUpdates: Record<string, unknown> = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.color !== undefined) dbUpdates.color = updates.color;
      if (updates.date !== undefined) dbUpdates.date = updates.date;

      if (Object.keys(dbUpdates).length === 0) {
        return fail('update_day: no fields provided to update');
      }

      const { data, error } = await sb
        .from('days_v2')
        .update(dbUpdates)
        .eq('id', day_id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) return fail(`update_day error: ${error.message}`);
      return ok(JSON.stringify(data, null, 2));
    },
  );

  server.tool(
    'remove_day',
    'Delete a days_v2 row. trip_days links cascade. Note: this removes the day for all trips linked to it.',
    removeDayShape,
    async ({ day_id }) => {
      const { sb, userId } = getSupabase();
      const { error } = await sb
        .from('days_v2')
        .delete()
        .eq('id', day_id)
        .eq('user_id', userId);

      if (error) return fail(`remove_day error: ${error.message}`);
      return ok(`Deleted day ${day_id}`);
    },
  );
}
