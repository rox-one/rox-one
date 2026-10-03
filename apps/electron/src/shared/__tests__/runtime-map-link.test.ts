import { describe, expect, test } from 'bun:test'
import { parseRuntimeMapLinkUrl, parseRuntimeMapViewRequest } from '../runtime-map-link'

describe('read-only runtime references', () => {
  test('round-trips historical run and operation identity without an action', () => {
    const eventId = JSON.stringify(['run-1', 'worker:child', 'tool', 'tool-7'])
    const query = new URLSearchParams({ workspace: 'ws-1', session: 'session-1', run: 'run-1', event: eventId })
    const target = parseRuntimeMapLinkUrl(new URL(`rox://runtime?${query}`))!
    expect(target.workspaceId).toBe('ws-1')
    expect(parseRuntimeMapViewRequest(target.view)).toEqual({ sessionId: 'session-1', rootRunId: 'run-1', eventId })
    expect(target.view.startsWith('allSessions/session/')).toBe(true)
  })
  test('rejects ambiguous, oversized, malformed and action references', () => {
    const base = 'rox://runtime?workspace=ws&session=s&run=r&event=e'
    for (const suffix of ['&run=other', '&session=other', '&send=true']) expect(parseRuntimeMapLinkUrl(new URL(base + suffix))).toBeNull()
    for (const url of [base.replace('session=s', 'session=..'), base.replace('run=r', 'run=a%2Fb'), base + '#action', base.replace('event=e', 'event=%00')]) expect(parseRuntimeMapLinkUrl(new URL(url))).toBeNull()
    expect(parseRuntimeMapLinkUrl(new URL(base.replace('event=e', `event=${'e'.repeat(8193)}`)))).toBeNull()
    for (const route of ['action/new-chat?runtimeRun=r&runtimeEvent=e', 'allSessions/session/s?runtimeRun=r&runtimeRun=x&runtimeEvent=e', 'allSessions/session/%2e%2e?runtimeRun=r&runtimeEvent=e', 'allSessions/session/s?runtimeRun=r&runtimeEvent=%ZZ']) expect(parseRuntimeMapViewRequest(route)).toBeNull()
  })
})
