import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-078..080 native Notes document actions', () => {
  test('NotesPage gates list/read/act and does not embed conation.dev', () => {
    const notes = source('apps/electron/src/renderer/pages/NotesPage.tsx')
    expect(notes).toContain('soupDocumentListResult')
    expect(notes).toContain('soupDocumentReadResult')
    expect(notes).toContain('soupDocumentActResult')
    expect(notes).toContain("action: 'write'")
    expect(notes).toContain("action: 'destroy'")
    expect(notes).not.toContain('conation.dev')
    expect(notes).not.toMatch(/<iframe\b/i)
    expect(notes).not.toContain('CompleteMutationRoot')
  })

  test('notes bridge stays flag-off and is not claimed live from NotesPage', () => {
    const bridge = source('packages/core/src/conation/notes/bridge.ts')
    expect(bridge).toContain('Flag-gated factory')
    expect(bridge).toContain('Read-only')
    const flags = source('packages/core/src/conation/notes/flags.ts')
    expect(flags).toContain('CONATION_NOTES_BRIDGE_DEFAULT = false')
  })
})
