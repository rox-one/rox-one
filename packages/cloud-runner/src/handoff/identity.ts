/**
 * id.rox.one subject resolution. The cloud session admits exactly the OIDC
 * `sub` that id.rox.one reports for the user's token (userinfo), so the pinned
 * owner and the browser login are the same identifier by construction.
 */
import { HandoffError } from './types.ts';

/** Linear-time trailing-slash trim (avoids a backtracking `/\/+$/` on untrusted input). */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RoxIdSubjectInput {
  issuer: string;
  accessToken: string;
  fetchImpl?: Fetch;
}

export async function fetchRoxIdSubject(input: RoxIdSubjectInput): Promise<string> {
  const http = input.fetchImpl ?? fetch;
  const issuer = stripTrailingSlashes(input.issuer);
  if (!/^https:\/\//i.test(issuer) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(issuer)) {
    throw new HandoffError('sso_not_configured', 'Rox ID issuer must be https');
  }
  if (!input.accessToken) throw new HandoffError('sign_in_required', 'no Rox ID token');
  let userinfoUrl: string;
  try {
    const disc = await http(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: 'application/json' } });
    if (!disc.ok) throw new Error(`discovery ${disc.status}`);
    const body = (await disc.json()) as { userinfo_endpoint?: unknown };
    if (typeof body.userinfo_endpoint !== 'string' || !body.userinfo_endpoint) throw new Error('no userinfo_endpoint');
    userinfoUrl = body.userinfo_endpoint;
  } catch {
    throw new HandoffError('provider_error', 'Rox ID is unavailable');
  }
  let res: Response;
  try {
    res = await http(userinfoUrl, { headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' } });
  } catch {
    throw new HandoffError('provider_error', 'Rox ID is unavailable');
  }
  if (res.status === 401 || res.status === 403) throw new HandoffError('sign_in_required', 'Rox ID session expired');
  if (!res.ok) throw new HandoffError('provider_error', `Rox ID userinfo failed (${res.status})`);
  const info = (await res.json().catch(() => null)) as { sub?: unknown } | null;
  const sub = typeof info?.sub === 'string' ? info.sub.trim() : '';
  if (!sub || /[\r\n\0,]/.test(sub)) throw new HandoffError('sign_in_required', 'Rox ID returned no subject');
  return sub;
}

export interface TokenAudienceInput {
  issuer: string;
  accessToken: string;
  /** Client ids (aud / azp / client_id) the broker accepts tokens for. Empty ⇒ reject all. */
  allowedClientIds: readonly string[];
  /** RFC 7662 introspection credentials, used for opaque (non-JWT) tokens. */
  introspection?: { clientId: string; clientSecret: string };
  fetchImpl?: Fetch;
}

function audiencesOf(claims: Record<string, unknown>): string[] {
  const out: string[] = [];
  const aud = claims.aud;
  if (typeof aud === 'string') out.push(aud);
  else if (Array.isArray(aud)) for (const a of aud) if (typeof a === 'string') out.push(a);
  for (const k of ['azp', 'client_id'] as const) if (typeof claims[k] === 'string') out.push(claims[k] as string);
  return out;
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as unknown;
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Check the token was issued to one of our clients. Call only AFTER userinfo
 * accepted the token (fetchRoxIdSubject): that is what proves a JWT genuine, so
 * its aud/azp/client_id claims can then be trusted. Opaque tokens go through
 * RFC 7662 introspection; without introspection credentials they are refused.
 * Also requires the token's `sub` (when present) to equal the userinfo `sub`.
 */
export async function verifyRoxIdTokenAudience(input: TokenAudienceInput, sub: string): Promise<boolean> {
  const allowed = new Set(input.allowedClientIds.map((c) => c.trim()).filter(Boolean));
  if (allowed.size === 0) return false;
  let claims = decodeJwtClaims(input.accessToken);
  if (!claims) {
    if (!input.introspection) return false;
    const http = input.fetchImpl ?? fetch;
    const issuer = stripTrailingSlashes(input.issuer);
    try {
      const disc = await http(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: 'application/json' } });
      const endpoint = ((await disc.json()) as { introspection_endpoint?: unknown }).introspection_endpoint;
      if (!disc.ok || typeof endpoint !== 'string') return false;
      const basic = Buffer.from(`${encodeURIComponent(input.introspection.clientId)}:${encodeURIComponent(input.introspection.clientSecret)}`).toString('base64');
      const res = await http(endpoint, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ token: input.accessToken, token_type_hint: 'access_token' }).toString(),
      });
      if (!res.ok) return false;
      claims = (await res.json()) as Record<string, unknown>;
      if (claims?.active !== true) return false;
    } catch {
      return false;
    }
  }
  if (typeof claims.sub === 'string' && claims.sub !== sub) return false;
  if (typeof claims.iss === 'string' && stripTrailingSlashes(claims.iss) !== stripTrailingSlashes(input.issuer)) return false;
  return audiencesOf(claims).some((a) => allowed.has(a));
}
