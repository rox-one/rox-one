import type { RoxAccountSnapshot } from '@rox/shared/auth'
import type { ProfileStripData } from './ProfileStrip'

/** Central identity/money stay unknown on outage; local XP cannot stand in. */
export function accountProfileStrip(local: ProfileStripData, account: RoxAccountSnapshot | null, spentUsd: number | null, defaultName: string): ProfileStripData {
  return { ...local, displayName: account?.user.name || account?.user.handle || defaultName,
    balance: account ? Number(account.balance.balanceRox) : null, spentUsd }
}
