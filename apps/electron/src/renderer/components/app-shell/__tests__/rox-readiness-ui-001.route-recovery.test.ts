import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../MainContentPanel.tsx', import.meta.url), 'utf8')

describe('ROX UI-001 route recovery contract', () => {
  it('keeps every accepted detail family on its own surface host', () => {
    for (const host of [
      'ChatPage', 'SourceInfoPage', 'SkillInfoPage', 'ProjectInfoPage', 'NotesPage',
      'PageView', 'KnowledgeEntityPage', 'ExtensionSurfacePage', 'TerminalSurfacePage',
      'CloudRunSurfacePage', 'ExtraScreenHost',
    ]) {
      expect(source).toContain(`<${host}`)
    }
  })

  it('renders an explicit unavailable state rather than an unrelated chat fallback', () => {
    const finalFallback = source.slice(source.lastIndexOf('return wrapWithStoplight'))
    expect(finalFallback).toContain('data-testid="route-unavailable"')
    expect(finalFallback).toContain("t('common.unavailable')")
    expect(finalFallback).not.toContain('session.selectConversation')
  })
})
