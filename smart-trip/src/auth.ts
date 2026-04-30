import type { Request, Response, NextFunction } from 'express';

/**
 * Bearer token middleware. Single-tenant: one token in env, that's it.
 *
 * Returns 401 with WWW-Authenticate so misconfigured clients see why.
 * If MCP_BEARER_TOKEN is not set, the server refuses to start (see server.ts).
 */
export function bearerAuth(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.header('authorization') ?? req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      res
        .status(401)
        .header('WWW-Authenticate', 'Bearer realm="smart-trip-mcp"')
        .json({ error: 'missing or malformed Authorization header' });
      return;
    }

    const token = auth.slice('Bearer '.length).trim();
    // Constant-time-ish compare (length first, then char-by-char)
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
      res.status(401).json({ error: 'invalid token' });
      return;
    }

    next();
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
