/**
 * Visitor-access bootstrap tests (port-matrix row a1.6).
 *
 * Pins the config gate: with visitor config present the `visitor-access` plugin
 * is registered and the hourly sweep is scheduled; absent (or disabled) config
 * registers NOTHING, so a role naming the plugin keeps being refused typed.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { configureVisitorAccess } from '../bootstrap.ts'
import { VISITOR_ACCESS_PLUGIN_NAME } from '../service.ts'
import type { AccessPolicyPlugin } from '../../authority/access-policy-registry.ts'
import { lookupAccessPolicyPlugin, resetAccessPolicyPlugins } from '../../authority/access-policy-registry.ts'

interface ScheduledRun {
  id: string
  everyMs: number
  run: () => void | Promise<void>
  stopped: boolean
}

function fakeScheduler() {
  const runs: ScheduledRun[] = []
  return {
    runs,
    scheduleEvery(params: ScheduledRun) {
      const entry: ScheduledRun = { ...params, stopped: false }
      runs.push(entry)
      return { stop: async () => { entry.stopped = true }, cancel: () => { entry.stopped = true } }
    },
  }
}

function clock(start = 10_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

afterEach(() => resetAccessPolicyPlugins())

describe('configureVisitorAccess', () => {
  test('registers the plugin and schedules the sweep when config is present', async () => {
    const scheduler = fakeScheduler()
    const registered: Array<{ name: string; plugin: AccessPolicyPlugin }> = []
    const runtime = configureVisitorAccess({
      config: { visitors: { provider: 'cloudflare-access', grantTtlDays: 7, sweepIntervalMinutes: 30 } },
      scheduler,
      register: (name, plugin) => registered.push({ name, plugin }),
    })

    expect(runtime.pluginRegistered).toBe(true)
    expect(runtime.service).not.toBeNull()
    expect(registered.map(entry => entry.name)).toEqual([VISITOR_ACCESS_PLUGIN_NAME])
    expect(typeof registered[0].plugin.authorize).toBe('function')
    expect(typeof registered[0].plugin.resume).toBe('function')

    expect(scheduler.runs).toHaveLength(1)
    expect(scheduler.runs[0].id).toBe('visitors.sweep')
    expect(scheduler.runs[0].everyMs).toBe(30 * 60_000)

    await runtime.dispose()
    expect(scheduler.runs[0].stopped).toBe(true)
  })

  test('registers nothing when visitor config is absent', () => {
    const scheduler = fakeScheduler()
    let registerCalls = 0
    const runtime = configureVisitorAccess({
      config: {},
      scheduler,
      register: () => { registerCalls += 1 },
    })

    expect(registerCalls).toBe(0)
    expect(runtime.pluginRegistered).toBe(false)
    expect(runtime.service).toBeNull()
    expect(scheduler.runs).toHaveLength(0)
    expect(lookupAccessPolicyPlugin(VISITOR_ACCESS_PLUGIN_NAME)).toBeNull()
  })

  test('registers nothing when visitor config is explicitly disabled', () => {
    const scheduler = fakeScheduler()
    let registerCalls = 0
    const runtime = configureVisitorAccess({
      config: { visitors: { enabled: false } },
      scheduler,
      register: () => { registerCalls += 1 },
    })
    expect(registerCalls).toBe(0)
    expect(runtime.service).toBeNull()
  })

  test('the registered plugin consults the grant store through real registration', async () => {
    const scheduler = fakeScheduler()
    const c = clock()
    const runtime = configureVisitorAccess({
      config: { visitors: {} },
      scheduler,
      now: c.now,
    })
    expect(lookupAccessPolicyPlugin(VISITOR_ACCESS_PLUGIN_NAME)).not.toBeNull()

    await runtime.service!.invite({ kind: 'email', email: 'guest@example.com' })
    const plugin = lookupAccessPolicyPlugin(VISITOR_ACCESS_PLUGIN_NAME)!
    const request = { channel: 'native:read', nativeAction: 'read', role: 'visitor', subject: 'guest@example.com' }
    expect(await plugin.authorize(request)).toBe(true)

    // The scheduled sweep reaps an expired grant.
    const store = runtime.service!.list()
    expect(store).toHaveLength(1)
    c.advance(15 * 24 * 60 * 60_000)
    await scheduler.runs[0].run()
    expect(runtime.service!.list()).toHaveLength(0)
    expect(await plugin.authorize(request)).toBe(false)
  })

  test('dispose is idempotent', async () => {
    const scheduler = fakeScheduler()
    const runtime = configureVisitorAccess({ config: { visitors: {} }, scheduler })
    await runtime.dispose()
    await runtime.dispose()
    expect(scheduler.runs[0].stopped).toBe(true)
  })
})