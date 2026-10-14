import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { PRIMARY_NAV, resolvePrimaryNav, BASE_SURFACE_FLAG, WIKI_SURFACE_FLAG } from '../primary-nav'

// Registry order with no pill on screen (WP6: pill-placed surfaces then fall back to the sidebar).
const ids = (flags: string[], modeFlags = {}) => resolvePrimaryNav({ shellFlags: new Set(flags), modeFlags, pillNavIds: new Set() })
const group = (flags: string[], g: 'primary' | 'more') => ids(flags).filter(e => e.group === g).map(e => e.id)

describe('WP5 primary-nav registry (#1580)', () => {
  it('flags off: primary = Inbox, Chat, Docs(notes), Tasks, Projects; no dead surfaces', () => {
    expect(group([], 'primary')).toEqual(['inbox', 'sessions', 'docs', 'tasks', 'projects'])
    const all = ids([]).map(e => e.id)
    for (const hidden of ['messenger', 'calendar', 'goals', 'base', 'wiki', 'developers', 'playbooks']) expect(all).not.toContain(hidden)
  })

  it('flags off: «Ещё» keeps every other destination (WP6: + Знания, Миссии)', () => {
    expect(group([], 'more')).toEqual([
      'memory', 'memoryRepo', 'learning', 'browser', 'automations', 'meetings', 'home', 'feed',
      'pages', 'knowledge', 'missions', 'drive', 'clipboardHistory', 'sources', 'skills', 'connections', 'settings',
    ])
  })

  it('flags on: spec order Inbox, Messenger, Docs, Calendar, Tasks, Goals; meetings alias hidden, projects demoted', () => {
    const flags = [WORKBENCH_FLAG.modeMessengerV1, WORKBENCH_FLAG.modeCalendarV1, WORKBENCH_FLAG.modeGoalsV1, WORKBENCH_FLAG.docsSharedV1, WORKBENCH_FLAG.devSpaceV1, WORKBENCH_FLAG.playbooksV1]
    expect(group(flags, 'primary')).toEqual(['inbox', 'sessions', 'messenger', 'docs', 'calendar', 'tasks', 'goals'])
    const more = group(flags, 'more')
    expect(more).not.toContain('meetings')
    expect(more).toContain('projects')
    expect(more.slice(-3)).toEqual(['developers', 'playbooks', 'settings'])
    expect(ids(flags).find(e => e.id === 'docs')?.labelKey).toBe('workbench.mode.docs')
  })

  it('Base and Wiki stay hidden even with their flag on until a root screen exists', () => {
    const all = ids([BASE_SURFACE_FLAG, WIKI_SURFACE_FLAG]).map(e => e.id)
    expect(all).not.toContain('base')
    expect(all).not.toContain('wiki')
  })

  it('a built mode screen whose flag is off is disabled, not hidden', () => {
    const inbox = ids([], { inbox: false }).find(e => e.id === 'inbox')
    expect(inbox?.disabled).toBe(true)
  })

  it('every label key has a Russian translation that is not English', () => {
    const root = resolve(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
    const ru = JSON.parse(readFileSync(resolve(root, 'ru.json'), 'utf8')) as Record<string, string>
    const en = JSON.parse(readFileSync(resolve(root, 'en.json'), 'utf8')) as Record<string, string>
    for (const key of new Set([...PRIMARY_NAV.map(e => e.labelKey), 'workbench.mode.docs', 'workbench.mode.more'])) {
      expect(ru[key], key).toBeTruthy()
      expect(ru[key], key).not.toBe(en[key])
    }
  })
})
