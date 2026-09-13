import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import {
  VOICE_OVERLAY_REQUIRES_CONATION_FLAG,
  VOICE_OVERLAY_SURFACE_ID,
  voiceOverlaySurfaceResult,
} from '../voice-overlay-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-040 native voice overlay surface', () => {
  test('voice overlay remains reachable without Conation flags', () => {
    expect(VOICE_OVERLAY_SURFACE_ID).toBe('voice-overlay')
    expect(VOICE_OVERLAY_REQUIRES_CONATION_FLAG).toBe(false)
    const overlay = source('apps/electron/src/renderer/voice-overlay.tsx')
    expect(overlay).toContain('VOICE_OVERLAY_REQUIRES_CONATION_FLAG')
    expect(overlay).not.toContain('conation.dev')
    expect(overlay).not.toMatch(/<iframe\b/i)
  })

  test('native overlay is live; fixture transcripts and conation are not', () => {
    expect(isClaimableLive(voiceOverlaySurfaceResult('native'))).toBe(false)
    expect(isClaimableLive(voiceOverlaySurfaceResult('fixture'))).toBe(false)
    expect(isClaimableLive(voiceOverlaySurfaceResult('conation'))).toBe(false)
  })
})
