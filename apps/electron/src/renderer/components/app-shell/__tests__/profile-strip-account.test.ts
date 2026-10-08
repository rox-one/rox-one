import { expect, test } from 'bun:test'
import { accountProfileStrip, resolveDisplayName } from '../profile-strip-account'
import type { RoxAccountSnapshot } from '@rox/shared/auth'

const local = { displayName: 'old local account', balance: 999, xp: 42, level: 2, progress: 0, xpIntoLevel: 0, xpForNext: 100, nextThreshold: 100 }
const cloud = { user: { name: 'Pocket account', handle: 'roxhandle' }, balance: { balanceRox: '0.000000' } } as RoxAccountSnapshot

test('the signed-in name wins: account → handle → local profile → default', () => {
  expect(resolveDisplayName(cloud, local.displayName, 'ROX user')).toBe('Pocket account')
  expect(resolveDisplayName({ ...cloud, user: { ...cloud.user, name: null } }, local.displayName, 'ROX user')).toBe('roxhandle')
  expect(resolveDisplayName(null, local.displayName, 'ROX user')).toBe('old local account')
  expect(resolveDisplayName(null, '', 'ROX user')).toBe('ROX user')
})

test('cloud footer keeps money unknown on logout/outage and never touches XP', () => {
  expect(accountProfileStrip(local, null, null, 'ROX user')).toMatchObject({ displayName: 'old local account', balance: null, xp: 42 })
  expect(accountProfileStrip(local, cloud, 0.5, 'ROX user')).toMatchObject({ displayName: 'Pocket account', balance: 0, xp: 42, spentUsd: 0.5 })
})