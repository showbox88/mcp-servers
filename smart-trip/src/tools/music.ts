/**
 * Music tools — search/browse/play the local MP3 library at /opt/music.
 *
 * Architecture (after confirming Claude.ai doesn't render inline audio):
 *   - Library lives on disk at /opt/music (writable via Samba from LAN clients).
 *   - We scan recursively at startup, parse ID3 tags via music-metadata,
 *     and keep an in-memory index. Cheap for up to ~10k tracks.
 *   - Tool responses include URLs (https://<MCP_PUBLIC_URL>/audio/<path>).
 *     User clicks → browser opens new tab → native player plays.
 *   - rescan_music tool lets the user (or LLM) refresh after dropping new files.
 *
 * URL construction: MCP_PUBLIC_URL env var is the funnel host (e.g.
 *   https://debian.tail4cfa2.ts.net). Each track's URL is built by
 *   joining MCP_PUBLIC_URL + "/audio/" + URL-encoded relative path.
 *
 * No auth on /audio (yet) — user said test-only, AI-generated content.
 * Add path-token auth before putting copyrighted material here.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { parseFile } from 'music-metadata';

interface Track {
  id: string;             // stable id derived from relative path
  rel_path: string;       // path inside MUSIC_DIR (forward slashes)
  title: string;
  artist: string;
  album: string;
  duration_sec: number | null;
  size_bytes: number;
  url: string;            // public playback URL
}

const MUSIC_DIR = process.env.MCP_MEDIA_DIR ?? '/opt/music';

let INDEX: Track[] = [];
let LAST_SCAN_AT: string | null = null;
let LAST_SCAN_ERROR: string | null = null;

function getPublicBase(): string {
  const u = process.env.MCP_PUBLIC_URL ?? '';
  return u.replace(/\/+$/, '');
}

function buildUrl(relPath: string): string {
  // Encode each segment so Chinese / spaces / special chars survive
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${getPublicBase()}/audio/${encoded}`;
}

function trackIdFromPath(relPath: string): string {
  // Stable id: prefix + simple hash of the path
  let h = 0;
  for (let i = 0; i < relPath.length; i++) {
    h = ((h << 5) - h + relPath.charCodeAt(i)) | 0;
  }
  return `t_${(h >>> 0).toString(36)}`;
}

async function walkMp3s(dir: string, root: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkMp3s(abs, root)));
    } else if (entry.isFile() && /\.(mp3|m4a|flac|ogg|opus|wav|aac)$/i.test(entry.name)) {
      out.push(relative(root, abs).split(sep).join('/'));
    }
  }
  return out;
}

async function scanLibrary(): Promise<{ count: number; failed: number }> {
  const start = Date.now();
  const relPaths = await walkMp3s(MUSIC_DIR, MUSIC_DIR);
  const tracks: Track[] = [];
  let failed = 0;

  for (const rel of relPaths) {
    const abs = join(MUSIC_DIR, ...rel.split('/'));
    let st;
    try {
      st = await stat(abs);
    } catch {
      failed++;
      continue;
    }
    let title = rel.replace(/\.[^.]+$/, '').split('/').pop() ?? rel;
    let artist = 'Unknown Artist';
    let album = 'Unknown Album';
    let duration: number | null = null;
    try {
      const meta = await parseFile(abs, { duration: true, skipCovers: true });
      title = meta.common.title?.trim() || title;
      artist = meta.common.artist?.trim() || artist;
      album = meta.common.album?.trim() || album;
      duration = meta.format.duration ? Math.round(meta.format.duration) : null;
    } catch {
      // Keep filename-derived metadata
    }
    tracks.push({
      id: trackIdFromPath(rel),
      rel_path: rel,
      title,
      artist,
      album,
      duration_sec: duration,
      size_bytes: st.size,
      url: buildUrl(rel),
    });
  }

  INDEX = tracks;
  LAST_SCAN_AT = new Date().toISOString();
  LAST_SCAN_ERROR = null;
  console.error(
    `[music] indexed ${tracks.length} tracks (${failed} failed) from ${MUSIC_DIR} in ${Date.now() - start}ms`,
  );
  return { count: tracks.length, failed };
}

// Kick off background scan on first import. The HTTP server can serve /healthz
// and other endpoints before this completes.
scanLibrary().catch((err) => {
  LAST_SCAN_ERROR = String(err?.message ?? err);
  console.error(`[music] initial scan failed:`, err);
});

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function matches(t: Track, q: string): number {
  // Lower-cased substring match across multiple fields with weighted score
  const ql = q.toLowerCase();
  const fields = [
    [t.title.toLowerCase(), 3],
    [t.artist.toLowerCase(), 2],
    [t.album.toLowerCase(), 2],
    [t.rel_path.toLowerCase(), 1],
  ] as const;
  let score = 0;
  for (const [f, w] of fields) {
    if (f.includes(ql)) score += w;
  }
  return score;
}

export function registerMusicTools(server: McpServer) {
  server.tool(
    'music_search',
    [
      'Search the local music library (parsed from ID3 tags).',
      'Matches against title / artist / album / path (case-insensitive substring).',
      'Returns the top N matches as objects with title, artist, album, duration_sec, url.',
      '',
      'The `url` field is a direct streamable MP3 URL the user can click to play in browser.',
      'Render results to the user as a markdown list of clickable links — one per song.',
    ].join('\n'),
    {
      query: z.string().min(1).describe('Free-text query, e.g. "周杰伦", "稻香", "夜曲专辑"'),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ query, limit }) => {
      if (INDEX.length === 0) {
        if (LAST_SCAN_ERROR) return fail(`music index empty (last scan error: ${LAST_SCAN_ERROR}). Try music_rescan.`);
        return fail('music index is empty. Drop MP3 files into the library and call music_rescan.');
      }
      const scored = INDEX
        .map((t) => ({ t, s: matches(t, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit ?? 10)
        .map(({ t }) => ({
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration_sec: t.duration_sec,
          url: t.url,
        }));
      return ok(JSON.stringify({ query, count: scored.length, results: scored }, null, 2));
    },
  );

  server.tool(
    'music_list_artists',
    'List all distinct artists in the library, sorted by track count desc.',
    {},
    async () => {
      const counts = new Map<string, number>();
      for (const t of INDEX) counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
      const list = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([artist, tracks]) => ({ artist, tracks }));
      return ok(JSON.stringify({ total_artists: list.length, artists: list }, null, 2));
    },
  );

  server.tool(
    'music_list_albums',
    'List albums (optionally filtered by artist), with track counts.',
    {
      artist: z.string().optional().describe('If provided, only return albums by this artist (case-insensitive substring).'),
    },
    async ({ artist }) => {
      const al = artist?.toLowerCase();
      const buckets = new Map<string, { artist: string; album: string; tracks: number }>();
      for (const t of INDEX) {
        if (al && !t.artist.toLowerCase().includes(al)) continue;
        const key = `${t.artist}\t${t.album}`;
        const cur = buckets.get(key);
        if (cur) cur.tracks++;
        else buckets.set(key, { artist: t.artist, album: t.album, tracks: 1 });
      }
      const list = [...buckets.values()].sort((a, b) =>
        a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album),
      );
      return ok(JSON.stringify({ count: list.length, albums: list }, null, 2));
    },
  );

  server.tool(
    'music_get_album_tracks',
    'Get all tracks of a specific album. Returns tracks with playable URLs.',
    {
      album: z.string().describe('Album name (case-insensitive substring match)'),
      artist: z.string().optional().describe('Optional artist filter (case-insensitive substring)'),
    },
    async ({ album, artist }) => {
      const al = album.toLowerCase();
      const ar = artist?.toLowerCase();
      const tracks = INDEX
        .filter((t) => t.album.toLowerCase().includes(al))
        .filter((t) => !ar || t.artist.toLowerCase().includes(ar))
        .map((t) => ({
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration_sec: t.duration_sec,
          url: t.url,
        }));
      if (tracks.length === 0) return fail(`No tracks found for album="${album}"${artist ? ` artist="${artist}"` : ''}`);
      return ok(JSON.stringify({ count: tracks.length, tracks }, null, 2));
    },
  );

  server.tool(
    'music_random',
    'Return N random tracks (DJ mode). Optionally filter by artist or album substring.',
    {
      count: z.number().int().min(1).max(50).optional().default(5),
      artist: z.string().optional(),
      album: z.string().optional(),
    },
    async ({ count, artist, album }) => {
      const ar = artist?.toLowerCase();
      const al = album?.toLowerCase();
      const pool = INDEX.filter(
        (t) =>
          (!ar || t.artist.toLowerCase().includes(ar)) &&
          (!al || t.album.toLowerCase().includes(al)),
      );
      if (pool.length === 0) return fail('Pool is empty after filters.');
      // Fisher-Yates partial shuffle
      const n = Math.min(count ?? 5, pool.length);
      const arr = [...pool];
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (arr.length - i));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      const picked = arr.slice(0, n).map((t) => ({
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration_sec: t.duration_sec,
        url: t.url,
      }));
      return ok(JSON.stringify({ count: picked.length, results: picked }, null, 2));
    },
  );

  server.tool(
    'music_rescan',
    [
      'Rescan /opt/music recursively, refresh the in-memory index.',
      'Call this after copying new MP3s to the library (e.g. via Samba).',
      'Returns indexed track count and elapsed time.',
    ].join('\n'),
    {},
    async () => {
      const start = Date.now();
      try {
        const { count, failed } = await scanLibrary();
        return ok(
          JSON.stringify(
            {
              indexed: count,
              failed_to_parse: failed,
              took_ms: Date.now() - start,
              last_scan_at: LAST_SCAN_AT,
              music_dir: MUSIC_DIR,
            },
            null,
            2,
          ),
        );
      } catch (err: any) {
        return fail(`Rescan failed: ${err?.message ?? err}`);
      }
    },
  );

  server.tool(
    'music_status',
    'Get music library status: track count, scan time, library dir, last error.',
    {},
    async () => {
      return ok(
        JSON.stringify(
          {
            indexed_tracks: INDEX.length,
            music_dir: MUSIC_DIR,
            public_base: getPublicBase() || '(MCP_PUBLIC_URL not set!)',
            last_scan_at: LAST_SCAN_AT,
            last_scan_error: LAST_SCAN_ERROR,
          },
          null,
          2,
        ),
      );
    },
  );
}
