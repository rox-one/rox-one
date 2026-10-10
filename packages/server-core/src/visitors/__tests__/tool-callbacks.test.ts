/**
 * Visitor tool-callback tests (port-matrix row a1.6): the agent-tool seam, its
 * typed unavailable refusal, and the canonical registry registration.
 */
import { describe, expect, test } from 'bun:test'
import { getSessionToolNames } from '@rox/session-tools-core'
import { VisitorGrantStore } from '../grant-store.ts'
import { VisitorAccessService } from '../service.ts'
import { buildVisitorToolCallbacks } from '../tool-callbacks.ts'

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map(block => block.text ?? '').join('\n')
}

describe('visitor tool callbacks', () => {
  test('invite / revoke / list are registered session tools', () => {
    const names = getSessionToolNames()
    expect(names.has('visitor_invite')).toBe(true)
    expect(names.has('visitor_revoke')).toBe(true)
    expect(names.has('visitor_list')).toBe(true)
  })

  test('all three report a typed VISITOR_STORE_UNAVAILABLE when unwired', async () => {
    const callbacks = buildVisitorToolCallbacks(() => null)
    for (const result of [
      await callbacks.invite({ email: 'a@example.com' }),
      await callbacks.revoke({ email: 'a@example.com' }),
      await callbacks.list({}),
    ]) {
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('VISITOR_STORE_UNAVAILABLE')
    }
  })

  test('invite then list then revoke round-trips through the service', async () => {
    const service = new VisitorAccessService({ store: new VisitorGrantStore({ timers: false }) })
    const callbacks = buildVisitorToolCallbacks(() => service)

    const invited = await callbacks.invite({ github: '7', ttlDays: 3, note: 'demo' })
    expect(invited.isError).toBe(false)
    expect(text(invited)).toContain('Granted visitor access to github:7')

    const listed = await callbacks.list({})
    expect(text(listed)).toContain('1 active visitor grant')
    expect(text(listed)).toContain('github:7')

    const revoked = await callbacks.revoke({ github: '7' })
    expect(revoked.isError).toBe(false)
    expect(text(revoked)).toContain('Revoked visitor access for github:7')

    const missing = await callbacks.revoke({ github: '7' })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('VISITOR_GRANT_NOT_FOUND')
  })

  test('a malformed selector refuses VISITOR_SUBJECT_INVALID', async () => {
    const service = new VisitorAccessService({ store: new VisitorGrantStore({ timers: false }) })
    const callbacks = buildVisitorToolCallbacks(() => service)
    const result = await callbacks.invite({})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('VISITOR_SUBJECT_INVALID')
  })
})