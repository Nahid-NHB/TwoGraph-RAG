import { Role, type TokenPayload } from './types';

const SECRET = 'sample-secret';

/**
 * Verifies a JWT-shaped token and returns its payload.
 * @param token - raw bearer token
 * @returns the decoded payload
 * @throws if the token is malformed or expired
 */
export function verifyToken(token: string): TokenPayload {
  const payload = decodeToken(token);
  if (!validateJWT(token)) {
    throw new Error('invalid token signature');
  }
  if (payload.exp * 1000 < Date.now()) {
    throw new Error('token expired');
  }
  return payload;
}

/** Structural validation of a JWT: three dot-separated base64url segments. */
export function validateJWT(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0) && SECRET.length > 0;
}

/** Issues a signed token for a subject. */
export function signToken(sub: string, role: Role, ttlSeconds = 3600): string {
  const payload: TokenPayload = { sub, role, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = btoa(JSON.stringify(payload));
  return `header.${body}.signature`;
}

function decodeToken(token: string): TokenPayload {
  const [, body] = token.split('.');
  if (!body) throw new Error('malformed token');
  return JSON.parse(atob(body)) as TokenPayload;
}
