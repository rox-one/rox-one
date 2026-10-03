import { expect, test } from 'bun:test'
import { createSecurityResource, type SecurityResourceState } from '../security/security-resource'

test('Rox readiness publishes while an optional security service is still loading', async () => {
  const rox: SecurityResourceState<string>[] = [], audit: SecurityResourceState<string>[] = []
  const runtime = createSecurityResource<string>(state => rox.push(state))
  const optional = createSecurityResource<string>(state => audit.push(state))
  const delayed = Promise.withResolvers<string>()
  const auditRead = optional.read('a', () => delayed.promise)
  await runtime.read('a', async () => 'installed-version')
  expect(rox.at(-1)).toEqual({ scope: 'a', phase: 'available', data: 'installed-version' })
  expect(audit.at(-1)?.phase).toBe('loading')
  delayed.resolve('audit-result'); await auditRead
})

test('one failing service does not erase another service, and its retry can recover', async () => {
  const states: SecurityResourceState<string>[] = []
  const resource = createSecurityResource<string>(state => states.push(state))
  await resource.read('a', async () => { throw new Error('unavailable') })
  expect(states.at(-1)).toEqual({ scope: 'a', phase: 'failed', data: null })
  await resource.read('a', async () => 'ready')
  expect(states.at(-1)).toEqual({ scope: 'a', phase: 'available', data: 'ready' })
})

test('A to B to A ignores replies from the first A generation', async () => {
  const states: SecurityResourceState<string>[] = []
  const resource = createSecurityResource<string>(state => states.push(state))
  const delayed = Promise.withResolvers<string>()
  const first = resource.read('a', () => delayed.promise)
  await resource.read('b', async () => 'workspace-b')
  await resource.read('a', async () => 'new-workspace-a')
  delayed.resolve('stale-private-a'); await first
  expect(states.at(-1)?.data).toBe('new-workspace-a')
  expect(states.some(state => state.data === 'stale-private-a')).toBe(false)
})

test('a subscribed status replaces a pending snapshot and ignores its later failure', async () => {
  const states: SecurityResourceState<string>[] = []
  const resource = createSecurityResource<string>(state => states.push(state))
  const delayed = Promise.withResolvers<string>()
  const pending = resource.read('a', () => delayed.promise)
  resource.replace('a', 'updated-installed-version')
  delayed.reject(new Error('old-status-request')); await pending
  expect(states.at(-1)).toEqual({ scope: 'a', phase: 'available', data: 'updated-installed-version' })
})

test('missing APIs report unavailable and disposed readers do not publish late success', async () => {
  const states: SecurityResourceState<string>[] = []
  const resource = createSecurityResource<string>(state => states.push(state))
  await resource.read('a')
  expect(states.at(-1)?.phase).toBe('unavailable')
  const delayed = Promise.withResolvers<string>()
  const pending = resource.read('a', () => delayed.promise)
  resource.cancel(); const before = states.length
  delayed.resolve('unmounted-result'); await pending
  expect(states).toHaveLength(before)
})
