/**
 * VisitorAccessService + plugin tests (port-matrix row a1.6).
 *
 * Covers the serialized mutation queue over the service, typed refusals, the
 * provider seam, and the `visitor-access` plugin's authorize/resume decisions.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { VisitorGrantStore } from '../grant-store.ts'
import { VisitorAccessService, VISITOR_ACCESS_PLUGIN_NAME } from '../service.ts'
import { VisitorProviderNotConfiguredError, createVisitorProvider } from '../provider.ts'
import { resetAccessPolicyPlugins, isAccessPolicyAdmitted, isAccessPolicyResumed } from '../../authority/access-policy-registry.ts'

function fixture(ttlMs = 60_000) {
  let now = 500_000
  const store = new VisitorGrantStore({ now: () => now, ttlMs, timers: false })
  const service = new VisitorAccessService({ store, now: () => now })
  return { store, service, advance: (ms: number) => { now += ms } }
}

const ADA = { kind: 'email' as const, email: 'ada@example.com' }

afterEach(() => resetAccessPolicyPlugins())

describe('VisitorAccessService mutations', () => {
  test('two concurrent invite/revoke calls apply in call order, never interleaved', async () => {
    const { service } = fixture()
    const [invited, revoked] = await Promise.all([service.invite(ADA), service.revoke(ADA)])

    expect(invited.ok).toBe(true)
    expect(revoked.ok).toBe(true)
    expect(service.audit.map(entry => entry.op)).toEqual(['invite', 'revoke'])
    expect(service.admits(ADA)).toBe(false)
  })

  test('invite replaces an existing grant and reports it', async () => {
    const { service } = fixture()
    expect((await service.invite(ADA)).ok).toBe(true)
    const second = await service.invite({ kind: 'github', accountId: '42' })
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.replaced).toBe(false)

    const renew = await service.invite(ADA)
    expect(renew.ok).toBe(true)
    if (renew.ok) expect(renew.replaced).toBe(true)
    expect(service.list().map(g => g.key).sort()).toEqual(['email:ada@example.com', 'github:42'])
  })

  test('revoking an identity without a live grant refuses VISITOR_GRANT_NOT_FOUND', async () => {
    const { service } = fixture()
    const result = await service.revoke(ADA)
    expect(result).toEqual({ ok: false, code: 'VISITOR_GRANT_NOT_FOUND', message: 'No live visitor grant for email:ada@example.com' })
  })

  test('an invalid subject refuses VISITOR_SUBJECT_INVALID', async () => {
    const { service } = fixture()
    const result = await service.invite({ kind: 'email', email: 'not-an-email' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VISITOR_SUBJECT_INVALID')
  })

  test('an expired grant stops admitting', async () => {
    const { service, advance } = fixture(1_000)
    await service.invite(ADA)
    expect(service.admits(ADA)).toBe(true)
    expect(service.admitsPrincipal('ada@example.com')).toBe(true)
    advance(2_000)
    expect(service.admits(ADA)).toBe(false)
    // Case/format normalization still resolves to the same canonical key.
    expect(service.admitsPrincipal('Ada@Example.com')).toBe(false)
  })
})

describe('VisitorAccessService provider seam', () => {
  test('no provider refuses typed VISITOR_PROVIDER_NOT_CONFIGURED', async () => {
    const { service } = fixture()
    expect(service.providerKind).toBeNull()
    await expect(service.resolveIdentity(ADA)).rejects.toBeInstanceOf(VisitorProviderNotConfiguredError)
  })

  test('a named provider exists but its live call is unimplemented and refuses typed', async () => {
    const store = new VisitorGrantStore({ timers: false })
    const service = new VisitorAccessService({ store, provider: createVisitorProvider({ provider: 'cloudflare-access' }) })
    expect(service.providerKind).toBe('cloudflare-access')
    try {
      await service.resolveIdentity(ADA)
      throw new Error('expected refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(VisitorProviderNotConfiguredError)
      if (error instanceof VisitorProviderNotConfiguredError) expect(error.code).toBe('VISITOR_PROVIDER_NOT_CONFIGURED')
    }
  })
})

describe('visitor-access plugin', () => {
  test('admits a granted visitor and denies an unlisted one', async () => {
    const { service } = fixture()
    await service.invite(ADA)
    const plugin = service.buildPlugin()
    const request = { channel: 'native:read', nativeAction: 'read', role: 'visitor', subject: 'ada@example.com' }

    expect(await plugin.authorize(request)).toBe(true)
    expect(await plugin.resume!(request)).toBe(true)
    expect(await plugin.authorize({ ...request, subject: 'stranger@example.com' })).toBe(false)
    // An opaque principal subject cannot be mapped to a visitor key → refuse.
    expect(await plugin.authorize({ ...request, subject: 'principal-7f3' })).toBe(false)
  })

  test('a role naming the plugin while it is NOT registered is refused typed', async () => {
    resetAccessPolicyPlugins()
    const request = { channel: 'native:read', nativeAction: 'read', role: 'visitor', subject: 'ada@example.com' }
    expect(await isAccessPolicyAdmitted(VISITOR_ACCESS_PLUGIN_NAME, request)).toBe(false)
    expect(await isAccessPolicyResumed(VISITOR_ACCESS_PLUGIN_NAME, request)).toBe(false)
  })
})