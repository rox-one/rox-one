import { expect, test } from 'bun:test'
import { accountProfileStrip, resolveDisplayName } from '../profile-strip-account'
import type { RoxAccountSnapshot } from '@rox/shared/auth'

const local = { displayName: 'old local account', balance: 999, xp: 42, level: 2, progress: 0, xpIntoLevel: 0, xpForNext: 100, nextThreshold: 100 }
// The strip reads the *available* (spendable) ROX, not the gross balance: the
// two differ here so the mapping is actually under test.
const cloud = { user: { name: 'Pocket account', handle: 'roxhandle' }, balance: { balanceRox: '999.000000', heldRox: '0.000000', availableRox: '12.500000' } } as RoxAccountSnapshot

test('the signed-in name wins: account → handle → local profile → default', () => {
  expect(resolveDisplayName(cloud, local.displayName, 'ROX user')).toBe('Pocket account')
  expect(resolveDisplayName({ ...cloud, user: { ...cloud.user, name: null } }, local.displayName, 'ROX user')).toBe('roxhandle')
  expect(resolveDisplayName(null, local.displayName, 'ROX user')).toBe('old local account')
  expect(resolveDisplayName(null, '', 'ROX user')).toBe('ROX user')
})

test('logout hides the cloud money and never lets local XP stand in for it', () => {
  const strip = accountProfileStrip(local, null, null, 'ROX user')
  expect(strip).toMatchObject({ displayName: 'old local account', balance: null, xp: 42 })
  // The local XP/balance must never leak into the money slot.
  expect(strip.balance).not.toBe(local.balance)
  expect(strip.xp).toBe(local.xp)
})

test('a transient outage keeps the last confirmed snapshot: available ROX shown, XP untouched', () => {
  // RoxAccountAuthority retains the last snapshot on offline/timeout/5xx and
  // flags updating=true; the strip therefore still renders the cloud balance.
  expect(accountProfileStrip(local, cloud, 0.5, 'ROX user')).toMatchObject({ displayName: 'Pocket account', balance: 12.5, xp: 42, spentUsd: 0.5 })
})