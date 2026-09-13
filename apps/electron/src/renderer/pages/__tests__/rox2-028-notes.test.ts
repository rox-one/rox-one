import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import {
  NOTES_REQUIRES_CONATION_FLAG,
  NOTES_SURFACE_ID,
  bindNativeNote,
  nativeNoteListResult,
  noteSurfaceResult,
} from '../notes-rox2-surface.ts'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-028 native notes surface', () => {
  test('notes remain reachable without Conation flags', () => {
    expect(NOTES_SURFACE_ID).toBe('notes')
    expect(NOTES_REQUIRES_CONATION_FLAG).toBe(false)
    const nav = source('apps/electron/src/renderer/components/app-shell/nav-destinations.ts')
    expect(nav).toContain("id: 'notes'")
    expect(nav).toContain('route: () => routes.view.notes()')
    const binder = source('apps/electron/src/renderer/pages/notes-rox2-surface.ts')
    expect(binder).toContain('NOTES_REQUIRES_CONATION_FLAG = false')
  })

  test('NotesPage and notes RPC have no conation.dev iframe', () => {
    const files = [
      'apps/electron/src/renderer/pages/NotesPage.tsx',
      'apps/electron/src/renderer/pages/KnowledgeSurfacePage.tsx',
      'packages/server-core/src/handlers/rpc/notes.ts',
    ]
    for (const rel of files) {
      const text = source(rel)
      expect(text, rel).not.toContain('conation.dev')
      expect(text, rel).not.toMatch(/<iframe\b/i)
    }
  })

  test('native note bind and empty list are live; fixture/conation are not', () => {
    const entity = bindNativeNote({
      id: 'daily',
      title: 'Daily',
      workspaceId: 'ws-1',
      updatedAt: 1,
    })
    expect(entity.id).toBe('note:daily')
    expect(entity.source).toBe('native')
    expect(isClaimableLive(nativeNoteListResult([]))).toBe(false)
    expect(isClaimableLive(noteSurfaceResult('fixture'))).toBe(false)
    expect(isClaimableLive(noteSurfaceResult('conation'))).toBe(false)
    expect(isClaimableLive(noteSurfaceResult('native'))).toBe(false)
  })
})
