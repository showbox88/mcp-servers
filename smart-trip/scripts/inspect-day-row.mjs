#!/usr/bin/env node
/**
 * Diagnostic: dump ALL columns of one days_v2 row.
 *
 * MCP currently selects only id/date/title/color/stops_data/created_at,
 * so any other columns Smart Trip uses (like a separate notes_data or
 * checklist_data field) are invisible to us. This script dumps the
 * full row to find them.
 *
 * Usage: sudo -u mcp node /opt/mcp-servers/smart-trip/scripts/inspect-day-row.mjs <day_id>
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '..', '.env') });

const dayId = process.argv[2];
if (!dayId) {
  console.error('Usage: node inspect-day-row.mjs <day_id>');
  process.exit(1);
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data, error } = await sb
  .from('days_v2')
  .select('*')           // ← all columns, not just MCP's subset
  .eq('id', dayId)
  .maybeSingle();

if (error) {
  console.error('error:', error.message);
  process.exit(1);
}
if (!data) {
  console.error('not found:', dayId);
  process.exit(1);
}

console.log('--- column names ---');
console.log(Object.keys(data).sort());
console.log('\n--- full row ---');
console.log(JSON.stringify(data, null, 2));
