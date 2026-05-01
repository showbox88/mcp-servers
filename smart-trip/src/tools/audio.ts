import { readFileSync, existsSync, statSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * One-tool experiment to find out whether Claude.ai (and other MCP clients)
 * render the `audio` content type inline as a playable widget.
 *
 * MCP spec supports `{ type: "audio", data: base64, mimeType }` alongside text
 * and image, but I haven't seen Claude.ai actually render an audio player from
 * a tool response yet. This is the cheapest way to find out.
 *
 * The tool reads /opt/music/test.mp3 (or MCP_AUDIO_TEST_FILE env override) and
 * returns it as base64 audio. If the file is large, the MCP message will be
 * large too — that's fine for a one-off test, but we'd swap to URL responses
 * in the real music MCP either way.
 */
export function registerAudioTools(server: McpServer) {
  server.tool(
    'get_audio_test',
    [
      'Return /opt/music/test.mp3 as inline base64 audio content (audio/mpeg).',
      '',
      'Diagnostic tool: used to discover whether the MCP client renders the',
      'audio content type as a native inline player. No parameters.',
      '',
      'Just call this once and return whatever the client shows you.',
      'If the client renders an audio widget — great, music MCP can use this',
      'pattern for short clips. If it shows raw text or fails — we fall back',
      'to URL-based responses (link in chat, browser plays in new tab).',
    ].join('\n'),
    {},
    async () => {
      const filePath = process.env.MCP_AUDIO_TEST_FILE ?? '/opt/music/test.mp3';
      if (!existsSync(filePath)) {
        return {
          content: [{ type: 'text' as const, text: `Test audio not found: ${filePath}` }],
          isError: true,
        };
      }

      const sizeBytes = statSync(filePath).size;
      const sizeKB = Math.round(sizeBytes / 1024);

      // Soft-cap: anything over ~3MB worth of base64 would be ~4MB on the wire
      // and chew lots of tokens. Refuse rather than blow up the conversation.
      const MAX_BYTES = 3 * 1024 * 1024;
      if (sizeBytes > MAX_BYTES) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Test audio is ${sizeKB} KB (> 3 MB cap). Truncate test.mp3 with ffmpeg to a short clip first, e.g.:\n  ffmpeg -i test.mp3 -t 10 -c copy short.mp3\n  mv short.mp3 test.mp3`,
            },
          ],
          isError: true,
        };
      }

      const bytes = readFileSync(filePath);
      console.error(`[get_audio_test] returning ${sizeKB} KB of audio/mpeg`);

      // Cast through `any` because the SDK TS types may lag behind the spec
      // for the audio content type. The wire format is correct.
      const audioContent = {
        type: 'audio',
        data: bytes.toString('base64'),
        mimeType: 'audio/mpeg',
      } as any;

      return {
        content: [audioContent],
      };
    },
  );
}
