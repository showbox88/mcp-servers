#!/usr/bin/env node
/**
 * One-time fix: copy stops_data[].note → stops_data[].desc for a given trip.
 *
 * Why: Smart Trip React UI renders stop body from `desc`, but Claude.ai (when
 * driven by add_stop schema docs) put descriptive content into `note`. Result:
 * UI cards look empty even though the data is in DB.
 *
 * This script is idempotent and conservative:
 *   - Only copies when desc is empty/missing AND note has content
 *   - Never overwrites existing desc
 *   - Never deletes note (kept for backward-compat / short-label use)
 *
 * Usage (run as the mcp user so .env is readable):
 *   sudo -u mcp node /opt/mcp-servers/smart-trip/scripts/fix-note-to-desc.mjs <trip_id>
 *
 * Example:
 *   sudo -u mcp node /opt/mcp-servers/smart-trip/scripts/fix-note-to-desc.mjs trip-1777589956946
 *
 * Add --dry-run to preview without writing.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '..', '.env') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tripId = args.find((a) => !a.startsWith('--'));

if (!tripId) {
  console.error('Usage: node fix-note-to-desc.mjs <trip_id> [--dry-run]');
  process.exit(1);
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const userId = process.env.DEFAULT_USER_ID;

const { data: links, error: linkErr } = await sb
  .from('trip_days')
  .select('day_id')
  .eq('trip_id', tripId);
if (linkErr) {
  console.error(`fetch trip_days failed:`, linkErr.message);
  process.exit(1);
}
if (!links?.length) {
  console.error(`trip ${tripId} has no linked days`);
  process.exit(1);
}
const dayIds = links.map((l) => l.day_id);
console.error(`trip ${tripId}: ${dayIds.length} linked days`);

const { data: days, error: daysErr } = await sb
  .from('days_v2')
  .select('id, date, stops_data')
  .in('id', dayIds)
  .eq('user_id', userId);
if (daysErr) {
  console.error(`fetch days_v2 failed:`, daysErr.message);
  process.exit(1);
}

let totalStops = 0;
let totalCopied = 0;
let daysTouched = 0;

for (const day of days.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
  const stops = Array.isArray(day.stops_data) ? day.stops_data : [];
  totalStops += stops.length;

  let dayCopied = 0;
  const newStops = stops.map((s) => {
    const hasNote = typeof s.note === 'string' && s.note.trim().length > 0;
    const hasDesc = typeof s.desc === 'string' && s.desc.trim().length > 0;
    if (hasNote && !hasDesc) {
      dayCopied++;
      return { ...s, desc: s.note };
    }
    return s;
  });

  if (dayCopied === 0) continue;

  if (dryRun) {
    console.error(`[dry-run] ${day.date}: would copy ${dayCopied} stops note→desc`);
  } else {
    const { error: updErr } = await sb
      .from('days_v2')
      .update({ stops_data: newStops })
      .eq('id', day.id)
      .eq('user_id', userId);
    if (updErr) {
      console.error(`${day.date}: update failed: ${updErr.message}`);
      continue;
    }
    console.error(`${day.date}: copied ${dayCopied} stops note→desc`);
  }
  totalCopied += dayCopied;
  daysTouched++;
}

console.error('---');
console.error(`days touched: ${daysTouched} / ${days.length}`);
console.error(`stops total:  ${totalStops}`);
console.error(`stops fixed:  ${totalCopied}${dryRun ? ' (dry-run, not written)' : ''}`);
