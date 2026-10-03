import { describe, expect, it } from 'bun:test'
import type { LoadedSkill, LoadedSource, Session } from '../../shared/types'
import { appendStarterPrompt, selectStarterPrompts, canShowStarterPrompts, starterHistoryId } from './starter-prompts'
const session = { id: 's', workspaceId: 'w', workspaceName: 'Test', lastMessageAt: 1, messages: [], isProcessing: false } as Session
const source: LoadedSource = { config: { id: 'g', slug: 'github', name: 'GitHub', provider: 'github', type: 'mcp', enabled: true, connectionStatus: 'connected', isAuthenticated: true }, guide: null, folderPath: '/w/sources/github', workspaceRootPath: '/w', workspaceId: 'w' }
const skill: LoadedSkill = { slug: 'research', source: 'workspace', path: '/w/skills/research', content: '', metadata: { name: 'Research', description: 'Research', requiredSources: ['github'] } }

describe('starter prompts are local draft preparation', () => {
  it('offers general prompts and only available, enabled skill/source dependencies', () => {
    const prompts = selectStarterPrompts({ session, sources: [source], skills: [skill], active: true, hasPendingRequest: false, now: 100 })
    expect(prompts.length).toBeLessThanOrEqual(4)
    expect(prompts.some(p => p.skill?.slug === 'research')).toBe(true)
    const unavailable = selectStarterPrompts({ session, sources: [{ ...source, config: { ...source.config, isAuthenticated: false } }], skills: [skill], active: true, hasPendingRequest: false, now: 100 })
    expect(unavailable.some(p => p.skill)).toBe(false)
  })
  it('preserves every draft character and only appends a prompt once', () => {
    const draft = '  Мой текст\n\n'
    const next = appendStarterPrompt(draft, 'Проверь проект')
    expect(next.startsWith(draft)).toBe(true)
    expect(appendStarterPrompt(next, 'Проверь проект')).toBe(next)
    expect(appendStarterPrompt('', 'Проверь проект')).toBe('Проверь проект')
  })
  it('suppresses starter advice during streaming, permissions, loading and old conversations', () => {
    const base = { session, active: true, hasPendingRequest: false }
    expect(canShowStarterPrompts(base)).toBe(true)
    expect(canShowStarterPrompts({ ...base, hasPendingRequest: true })).toBe(false)
    expect(canShowStarterPrompts({ ...base, session: { ...session, isProcessing: true } })).toBe(false)
    expect(canShowStarterPrompts({ ...base, session: { ...session, messages: [{ role: 'user', content: 'hello' }] } as Session })).toBe(false)
    expect(canShowStarterPrompts({ ...base, active: false })).toBe(false)
  })
  it('uses shared dismissal history scoped by workspace/session and skips shadowed skills', () => {
    const options = { session, sources: [], skills: [], active: true, hasPendingRequest: false, now: 100 }
    const first = selectStarterPrompts(options)[0]!
    expect(selectStarterPrompts({ ...options, history: { seen: { [starterHistoryId(session, first.id)]: 99 }, lastShownAt: 99 } }).some(p => p.id === first.id)).toBe(false)
    expect(selectStarterPrompts({ ...options, sources: [source], skills: [{ ...skill, shadowedByCraft: true }] }).some(p => p.skill)).toBe(false)
  })
})
