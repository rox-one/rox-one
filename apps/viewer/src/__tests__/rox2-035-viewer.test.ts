import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import {
  VIEWER_REQUIRES_CONATION_FLAG,
  VIEWER_SURFACE_ID,
  bindNativeSharedSession,
  viewerSurfaceResult,
} from '../rox2-viewer-surface.ts'

const ROOT = join(import.meta.dir, '../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-035 native viewer share surface', () => {
  test('viewer remains reachable without Conation flags', () => {
    expect(VIEWER_SURFACE_ID).toBe('viewer')
    expect(VIEWER_REQUIRES_CONATION_FLAG).toBe(false)
    const app = source('apps/viewer/src/App.tsx')
    expect(app).toContain('VIEWER_REQUIRES_CONATION_FLAG')
    expect(app).not.toContain('conation.dev')
    expect(app).not.toMatch(/<iframe\b/i)
  })

  test('native shared session bind is live; fixture and conation are not', () => {
    const entity = bindNativeSharedSession({
      id: 'share-1',
      title: 'Shared',
      workspaceId: 'ws-1',
      updatedAt: 1,
    })
    expect(entity.source).toBe('native')
    expect(entity.permissions).toEqual(['read'])
    expect(isClaimableLive(viewerSurfaceResult('native'))).toBe(true)
    expect(isClaimableLive(viewerSurfaceResult('fixture'))).toBe(false)
    expect(isClaimableLive(viewerSurfaceResult('conation'))).toBe(false)
  })
})
