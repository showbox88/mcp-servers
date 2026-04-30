import type { Request, Response, NextFunction } from 'express';

/**
 * Bearer token middleware. Single-tenant: one token in env, that's it.
 *
 * Token is accepted from EITHER:
 *   1. Authorization: Bearer <token>  header  (preferred — Claude Code, curl)
 *   2. URL path: /mcp/<token>                 (workaround — Claude.ai connector
 *      UI only supports OAuth, no header field, so we accept the token in URL)
 *
 * Path-based tokens leak into HTTP access logs. Acceptable for single-user
 * personal use; rotate token if logs are shared. For shared/multi-tenant
 * deployments, swap to proper OAuth.
 *
 * Returns 401 with WWW-Authenticate so misconfigured clients see why.
 */
export function bearerAuth(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Source 1: Authorization header
    const auth = req.header('authorization') ?? req.header('Authorization');
    let token: string | null = null;
    if (auth?.startsWith('Bearer ')) {
      token = auth.slice('Bearer '.length).trim();
    }

    // Source 2: URL path param (set by route /mcp/:token)
    if (!token && (req.params as any)?.token) {
      token = String((req.params as any).token).trim();
    }

    if (!token) {
      res
        .status(401)
        .header('WWW-Authenticate', 'Bearer realm="smart-trip-mcp"')
        .json({ error: 'missing token (Authorization: Bearer <token> or /mcp/<token>)' });
      return;
    }

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
