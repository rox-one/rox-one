import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Splash / cold_ready leftover after settings-lazy (#961).
 *
 * isFullyReady = appState === 'ready' && sessionsLoaded. Awaiting per-session
 * permission reconcile before setSessionsLoaded keeps the splash up for O(n)
 * IPC after getSessions already seeded permissionMode — flagged by the perf
 * probe as sessions.permission N+1.
 */
const appSource = readFileSync(join(import.meta.dir, '../../App.tsx'), 'utf8')

function loadSessionsFromServerBody(source: string): string {
  const start = source.indexOf('const loadSessionsFromServer = useCallback')
  expect(start).toBeGreaterThanOrEqual(0)
  // End at the next top-level useCallback in App (refresh path).
  const end = source.indexOf('const refreshSessionListMetadataFromServer', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('splash sessionsLoaded gate', () => {
  it('marks sessionsLoaded before awaiting per-session permission reconcile', () => {
    const body = loadSessionsFromServerBody(appSource)

    const loadedIdx = body.indexOf('setSessionsLoaded(true)')
    expect(loadedIdx).toBeGreaterThanOrEqual(0)

    // Cold-load must not `await` the reconcile fan-out before splash-ready.
    expect(body).not.toMatch(
      /await\s+Promise\.allSettled\(\s*loadedSessions\.map\(\(s\)\s*=>\s*reconcilePermissionModeState/,
    )

    // Background reconcile still happens (modeVersion sync) after ready.
    expect(body).toMatch(
      /void\s+Promise\.allSettled\(\s*loadedSessions\.map\(\(s\)\s*=>\s*reconcilePermissionModeState/,
    )

    const reconcileIdx = body.search(
      /void\s+Promise\.allSettled\(\s*loadedSessions\.map\(\(s\)\s*=>\s*reconcilePermissionModeState/,
    )
    expect(reconcileIdx).toBeGreaterThan(loadedIdx)
  })

  it('still seeds sessionOptions from getSessions before splash-ready', () => {
    const body = loadSessionsFromServerBody(appSource)
    const optionsIdx = body.indexOf('setSessionOptions(optionsMap)')
    const loadedIdx = body.indexOf('setSessionsLoaded(true)')
    expect(optionsIdx).toBeGreaterThanOrEqual(0)
    expect(loadedIdx).toBeGreaterThan(optionsIdx)
    expect(body).toContain('permissionMode: s.permissionMode')
  })
})
