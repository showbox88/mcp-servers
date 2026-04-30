import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cached: { sb: SupabaseClient; userId: string } | null = null;

export function getSupabase(): { sb: SupabaseClient; userId: string } {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.DEFAULT_USER_ID;

  if (!url || !key || !userId) {
    throw new Error(
      'Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEFAULT_USER_ID must all be set in .env',
    );
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  cached = { sb, userId };
  return cached;
}
