import { expect, test } from 'bun:test'
import { accountProfileStrip } from '../profile-strip-account'
import type { RoxAccountSnapshot } from '@rox/shared/auth'

const local = { displayName: 'old local account', balance: 999, xp: 42, level: 2, progress: 0, xpIntoLevel: 0, xpForNext: 100, nextThreshold: 100 }
test('cloud footer cannot inherit local identity or money during logout/outage; XP stays separate', () => {
  expect(accountProfileStrip(local, null, null, 'ROX user')).toMatchObject({ displayName: 'ROX user', balance: null, xp: 42 })
  const cloud = { user: { name: 'Pocket account', handle: 'roxhandle' }, balance: { balanceRox: '0.000000' } } as RoxAccountSnapshot
  expect(accountProfileStrip(local, cloud, 0.5, 'ROX user')).toMatchObject({ displayName: 'Pocket account', balance: 0, xp: 42, spentUsd: 0.5 })
  expect(accountProfileStrip(local, { ...cloud, user: { ...cloud.user, name: null } }, null, 'ROX user').displayName).toBe('roxhandle')
})
