/**
 * Access-policy RESUME admission tests (port-matrix row a1.6).
 *
 * `isAccessPolicyResumed` mirrors the fail-closed `isAccessPolicyAdmitted`
 * contract but consults `resume` when a plugin declares one, falling back to
 * `authorize` otherwise. A named-but-unregistered plugin still refuses.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  isAccessPolicyAdmitted,
  isAccessPolicyResumed,
  registerAccessPolicyPlugin,
  resetAccessPolicyPlugins,
} from '../access-policy-registry.ts'

const request = { channel: 'native:read', nativeAction: 'read', role: 'visitor', subject: 'ada@example.com' }

afterEach(() => resetAccessPolicyPlugins())

describe('isAccessPolicyResumed', () => {
  test('falls back to authorize when the plugin declares no resume', async () => {
    registerAccessPolicyPlugin('authorize-only', { authorize: () => true })
    expect(await isAccessPolicyResumed('authorize-only', request)).toBe(true)

    registerAccessPolicyPlugin('authorize-denies', { authorize: () => false })
    expect(await isAccessPolicyResumed('authorize-denies', request)).toBe(false)
  })

  test('consults resume in preference to authorize', async () => {
    registerAccessPolicyPlugin('split', { authorize: () => true, resume: () => false })
    expect(await isAccessPolicyAdmitted('split', request)).toBe(true)
    expect(await isAccessPolicyResumed('split', request)).toBe(false)
  })

  test('a throwing resume fails closed', async () => {
    registerAccessPolicyPlugin('boom', { authorize: () => true, resume: () => { throw new Error('nope') } })
    expect(await isAccessPolicyResumed('boom', request)).toBe(false)
  })

  test('a named-but-unregistered plugin refuses', async () => {
    expect(await isAccessPolicyResumed('ghost', request)).toBe(false)
  })

  test('a ceiling without a plugin name is unaffected', async () => {
    expect(await isAccessPolicyResumed(null, request)).toBe(true)
    expect(await isAccessPolicyResumed('', request)).toBe(true)
  })
})