import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markSessionsReadyThenReconcile } from '../splash-sessions-ready'

/**
 * Splash / cold_ready leftover after settings-lazy (#961).
 *
 * isFullyReady = appState === 'ready' && sessionsLoaded. Awaiting per-session
 * permission reconcile before setSessionsLoaded keeps the splash up for O(n)
 * IPC after getSessions already seeded permissionMode — flagged by the perf
 * probe as sessions.permission N+1.
 */
const appSource = readFileSync(join(import.meta.dir, '../../App.tsx'), 'utf8')
const helperSource = readFileSync(join(import.meta.dir, '../splash-sessions-ready.ts'), 'utf8')

function loadSessionsFromServerBody(source: string): string {
  const start = source.indexOf('const loadSessionsFromServer = useCallback')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('const refreshSessionListMetadataFromServer', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('markSessionsReadyThenReconcile', () => {
  it('marks ready before reconcile starts', async () => {
    const order: string[] = []
    let resolveReconcile!: () => void
    const reconcileDone = new Promise<void>((r) => {
      resolveReconcile = r
    })

    markSessionsReadyThenReconcile({
      markReady: () => {
        order.push('ready')
      },
      reconcileAll: async () => {
        order.push('reconcile-start')
        resolveReconcile()
        order.push('reconcile-end')
      },
    })

    expect(order[0]).toBe('ready')
    await reconcileDone
    expect(order).toEqual(['ready', 'reconcile-start', 'reconcile-end'])
  })

  it('does not await reconcile (returns synchronously)', () => {
    let ready = false
    let reconcileStarted = false
    markSessionsReadyThenReconcile({
      markReady: () => {
        ready = true
      },
      reconcileAll: () => {
        reconcileStarted = true
        return new Promise(() => {})
      },
    })
    expect(ready).toBe(true)
    expect(reconcileStarted).toBe(true)
  })
})

describe('splash sessionsLoaded gate (App wiring)', () => {
  it('uses markSessionsReadyThenReconcile in loadSessionsFromServer', () => {
    const body = loadSessionsFromServerBody(appSource)
    expect(body).toContain('markSessionsReadyThenReconcile')
    expect(body).not.toMatch(
      /await\s+Promise\.allSettled\(\s*loadedSessions\.map\(\(s\)\s*=>\s*reconcilePermissionModeState/,
    )
    expect(appSource).toContain("from '@/lib/splash-sessions-ready'")
    expect(helperSource).toContain('args.markReady()')
    expect(helperSource).toMatch(/void args\.reconcileAll\(\)/)
  })

  it('still seeds sessionOptions from getSessions before splash-ready helper', () => {
    const body = loadSessionsFromServerBody(appSource)
    const optionsIdx = body.indexOf('setSessionOptions(optionsMap)')
    const helperIdx = body.indexOf('markSessionsReadyThenReconcile')
    expect(optionsIdx).toBeGreaterThanOrEqual(0)
    expect(helperIdx).toBeGreaterThan(optionsIdx)
    expect(body).toContain('permissionMode: s.permissionMode')
  })
})
