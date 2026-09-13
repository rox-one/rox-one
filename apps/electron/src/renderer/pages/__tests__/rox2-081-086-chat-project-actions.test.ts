import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-081..086 native Chat and Project document actions', () => {
  test('ChatPage gates list/read/act and does not embed conation.dev', () => {
    const chat = source('apps/electron/src/renderer/pages/ChatPage.tsx')
    expect(chat).toContain('soupChatListResult')
    expect(chat).toContain('soupChatReadResult')
    expect(chat).toContain('soupChatActResult')
    expect(chat).toContain("action: 'write'")
    expect(chat).toContain("action: 'destroy'")
    expect(chat).not.toContain('conation.dev')
    expect(chat).not.toMatch(/<iframe\b/i)
    expect(chat).not.toContain('CompleteMutationRoot')
  })

  test('ProjectInfoPage gates list/read/act and does not embed conation.dev', () => {
    const project = source('apps/electron/src/renderer/pages/ProjectInfoPage.tsx')
    expect(project).toContain('soupProjectListResult')
    expect(project).toContain('soupProjectReadResult')
    expect(project).toContain('soupProjectActResult')
    expect(project).toContain("action: 'write'")
    expect(project).toContain("action: 'destroy'")
    expect(project).not.toContain('conation.dev')
    expect(project).not.toMatch(/<iframe\b/i)
    expect(project).not.toContain('CompleteMutationRoot')
  })
})
