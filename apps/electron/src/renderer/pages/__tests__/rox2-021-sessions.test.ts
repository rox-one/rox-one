import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import {
  SESSIONS_REQUIRES_CONATION_FLAG,
  SESSIONS_SURFACE_ID,
  bindNativeSession,
  nativeSessionListResult,
  sessionSurfaceResult,
} from '../chat-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-021 native sessions surface', () => {
  test('sessions remain reachable without Conation flags', () => {
    expect(SESSIONS_SURFACE_ID).toBe('sessions')
    expect(SESSIONS_REQUIRES_CONATION_FLAG).toBe(false)
    const nav = source('apps/electron/src/renderer/components/app-shell/nav-destinations.ts')
    expect(nav).toContain("id: 'sessions'")
    expect(nav).toContain('SESSIONS_REQUIRES_CONATION_FLAG = false')
    expect(nav).toContain('route: () => routes.view.allSessions()')
    expect(nav).not.toContain('workbench.conation')
  })

  test('ChatPage and nav have no conation.dev iframe', () => {
    const chat = source('apps/electron/src/renderer/pages/ChatPage.tsx')
    const nav = source('apps/electron/src/renderer/components/app-shell/nav-destinations.ts')
    for (const text of [chat, nav]) {
      expect(text).not.toContain('conation.dev')
      expect(text).not.toMatch(/<iframe\b/i)
    }
  })

  test('native session bind and empty list are live; fixture/conation are not', () => {
    const entity = bindNativeSession({
      id: 'abc',
      title: 'Daily',
      workspaceId: 'ws-1',
      updatedAt: 1,
    })
    expect(entity.id).toBe('session:abc')
    expect(entity.source).toBe('native')
    expect(isClaimableLive(nativeSessionListResult([]))).toBe(true)
    expect(isClaimableLive(nativeSessionListResult([entity]))).toBe(true)
    expect(isClaimableLive(sessionSurfaceResult('fixture'))).toBe(false)
    expect(isClaimableLive(sessionSurfaceResult('conation'))).toBe(false)
    expect(isClaimableLive(sessionSurfaceResult('native'))).toBe(true)
  })
})
