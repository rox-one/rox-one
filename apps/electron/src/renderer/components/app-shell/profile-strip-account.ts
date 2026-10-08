import type { RoxAccountSnapshot } from '@rox/shared/auth'
import type { ProfileStripData } from './ProfileStrip'

/**
 * Single source of truth for the signed-in display name across every identity
 * surface (profile strip, popover, avatar menu, account settings):
 * Rox cloud account name → account handle → local profile name → default.
 *
 * The name the user signed in with wins; the local profile only backs it up so
 * the surface never falls back to a bare «Пользователь» while a name exists.
 */
export function resolveDisplayName(
  account: RoxAccountSnapshot | null,
  localName: string | null | undefined,
  defaultName: string,
): string {
  return account?.user.name || account?.user.handle || localName || defaultName
}

/** Cloud money stays unknown on outage; the display name merges cloud → local → default. */
export function accountProfileStrip(local: ProfileStripData, account: RoxAccountSnapshot | null, spentUsd: number | null, defaultName: string): ProfileStripData {
  return { ...local, displayName: resolveDisplayName(account, local.displayName, defaultName),
    balance: account ? Number(account.balance.availableRox) : null, spentUsd }
}