/**
 * Daytona API key resolution for cloud handoff.
 *
 * Order: the user's own key (encrypted credential store) → the server-wide
 * default from `ROX_CLOUD_HANDOFF_DAYTONA_API_KEY` (server process env only).
 * The key is never returned to a client; callers only ever see `source`.
 */
import { HandoffError } from './types.ts';

export const HANDOFF_DEFAULT_KEY_ENV = 'ROX_CLOUD_HANDOFF_DAYTONA_API_KEY';

export interface ResolvedHandoffKey {
  key: string;
  source: 'user' | 'server_default';
}

export interface HandoffKeySources {
  readUserKey: () => Promise<string | null | undefined>;
  env?: Record<string, string | undefined>;
  /** Operators can forbid the shared default (e.g. on self-hosted builds). */
  allowServerDefault?: boolean;
}

export function serverDefaultKeyAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env[HANDOFF_DEFAULT_KEY_ENV]?.trim());
}

export async function resolveHandoffKey(sources: HandoffKeySources): Promise<ResolvedHandoffKey> {
  let user: string | null | undefined;
  try {
    user = (await sources.readUserKey())?.trim();
  } catch {
    // An unreadable credential store must not silently bill the shared key:
    // surface it as "no key" so the user can re-enter theirs.
    throw new HandoffError('no_key', 'could not read the saved Daytona key');
  }
  if (user) return { key: user, source: 'user' };
  if (sources.allowServerDefault !== false) {
    const fallback = (sources.env ?? process.env)[HANDOFF_DEFAULT_KEY_ENV]?.trim();
    if (fallback) return { key: fallback, source: 'server_default' };
  }
  throw new HandoffError('no_key', 'no Daytona API key configured');
}

/** Basic shape check for user-entered keys (no network). */
export function isPlausibleDaytonaKey(value: string): boolean {
  const v = value.trim();
  return v.length >= 16 && v.length <= 512 && /^[\x21-\x7e]+$/.test(v);
}
