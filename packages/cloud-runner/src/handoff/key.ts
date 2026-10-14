/**
 * Daytona key resolution for cloud handoff on the desktop.
 *
 * The desktop only ever uses the user's own key (encrypted credential store).
 * Default-key handoffs go through the Rox-hosted broker, which alone holds
 * `HANDOFF_DEFAULT_KEY_ENV`; nothing here reads that variable.
 */
import { HandoffError } from './types.ts';

/** Shared Daytona key — read only by the hosted broker (never in Electron). */
export const HANDOFF_DEFAULT_KEY_ENV = 'ROX_CLOUD_HANDOFF_DAYTONA_API_KEY';
/** Desktop: where default-key handoffs are brokered. */
export const HANDOFF_BROKER_URL_ENV = 'ROX_CLOUD_HANDOFF_BROKER_URL';

/** Returns the user's own key, or null. An unreadable store is `no_key`, never a silent fallback. */
export async function readPersonalHandoffKey(readUserKey: () => Promise<string | null | undefined>): Promise<string | null> {
  let user: string | null | undefined;
  try {
    user = (await readUserKey())?.trim();
  } catch {
    throw new HandoffError('no_key', 'could not read the saved Daytona key');
  }
  return user || null;
}

/** Basic shape check for user-entered keys (no network). */
export function isPlausibleDaytonaKey(value: string): boolean {
  const v = value.trim();
  return v.length >= 16 && v.length <= 512 && /^[\x21-\x7e]+$/.test(v);
}
