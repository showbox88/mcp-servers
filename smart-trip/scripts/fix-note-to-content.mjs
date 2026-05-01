#!/usr/bin/env node
/**
 * Fix v2: copy stops_data[].note → .content for type='note' stops.
 *
 * Discovery (via UI reverse-engineering): Smart Trip React UI renders the
 * body of a type='note' stop from the `content` field — not `note` or
 * `desc`. UI-created notes look like:
 *   { id: "n<ts>", type: "note", checked: false, content: "<body>" }
 *
 * Our previous v1 fix copied note → desc which was wrong (UI ignores desc
 * for notes). This script copies note → content, which is what UI reads.
 *
 * Conservative & idempotent:
 *   - Only touches type='note' stops
 *   - Only copies when content is empty/missing AND note has text
 *   - Adds checked:false if missing (default UI state)
 *   - Never overwrites existing content
 *   - Never deletes note (kept in case schema evolves)
 *
 * Usage (run as the mcp user so .env is readable):
 *   sudo -u mcp node /opt/mcp-servers/smart-trip/scripts/fix-note-to-content.mjs <trip_id>
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
  console.error('Usage: node fix-note-to-content.mjs <trip_id> [--dry-run]');
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
let totalNotes = 0;
let totalCopied = 0;
let daysTouched = 0;

for (const day of days.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
  const stops = Array.isArray(day.stops_data) ? day.stops_data : [];
  totalStops += stops.length;

  let dayCopied = 0;
  const newStops = stops.map((s) => {
    if (s.type !== 'note') return s;
    totalNotes++;
    const hasNote = typeof s.note === 'string' && s.note.trim().length > 0;
    const hasContent = typeof s.content === 'string' && s.content.trim().length > 0;
    if (hasNote && !hasContent) {
      dayCopied++;
      const out = { ...s, content: s.note };
      if (typeof out.checked !== 'boolean') out.checked = false;
      return out;
    }
    // Make sure existing notes also have checked field (UI quality-of-life)
    if (typeof s.checked !== 'boolean') {
      return { ...s, checked: false };
    }
    return s;
  });

  if (dayCopied === 0) continue;

  if (dryRun) {
    console.error(`[dry-run] ${day.date}: would copy ${dayCopied} notes note→content`);
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
    console.error(`${day.date}: copied ${dayCopied} notes note→content`);
  }
  totalCopied += dayCopied;
  daysTouched++;
}

console.error('---');
console.error(`days touched:    ${daysTouched} / ${days.length}`);
console.error(`stops total:     ${totalStops}`);
console.error(`note-type stops: ${totalNotes}`);
console.error(`stops fixed:     ${totalCopied}${dryRun ? ' (dry-run, not written)' : ''}`);
