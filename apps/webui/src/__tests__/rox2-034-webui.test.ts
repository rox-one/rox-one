import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import {
  WEBUI_REQUIRES_CONATION_FLAG,
  WEBUI_SURFACE_ID,
  webuiSurfaceResult,
} from '../rox2-webui-surface.ts'

const ROOT = join(import.meta.dir, '../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-034 native web UI surface', () => {
  test('webui remains reachable without Conation flags', () => {
    expect(WEBUI_SURFACE_ID).toBe('webui')
    expect(WEBUI_REQUIRES_CONATION_FLAG).toBe(false)
    const app = source('apps/webui/src/App.tsx')
    expect(app).toContain('WEBUI_REQUIRES_CONATION_FLAG')
    expect(app).not.toContain('conation.dev')
    expect(app).not.toMatch(/<iframe\b/i)
  })

  test('native webui is live; fixture and conation are not', () => {
    expect(isClaimableLive(webuiSurfaceResult('native'))).toBe(false)
    expect(isClaimableLive(webuiSurfaceResult('fixture'))).toBe(false)
    expect(isClaimableLive(webuiSurfaceResult('conation'))).toBe(false)
  })
})
