/**
 * id.rox.one subject resolution. The cloud session admits exactly the OIDC
 * `sub` that id.rox.one reports for the user's token (userinfo), so the pinned
 * owner and the browser login are the same identifier by construction.
 */
import { HandoffError } from './types.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RoxIdSubjectInput {
  issuer: string;
  accessToken: string;
  fetchImpl?: Fetch;
}

export async function fetchRoxIdSubject(input: RoxIdSubjectInput): Promise<string> {
  const http = input.fetchImpl ?? fetch;
  const issuer = input.issuer.replace(/\/+$/, '');
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
