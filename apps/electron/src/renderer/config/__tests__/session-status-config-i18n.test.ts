import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import {
  DEFAULT_STATUS_IDS,
  resolveLabelDisplayName,
  resolveStatusDisplayLabel,
  resolveViewDisplayDescription,
  resolveViewDisplayName,
} from '../session-status-config'

const source = readFileSync(join(import.meta.dir, '../session-status-config.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const STATUS_KEYS = [
  'status.backlog',
  'status.todo',
  'status.in-progress',
  'status.needs-review',
  'status.done',
  'status.cancelled',
] as const

const LABEL_KEYS = [
  'label.default.automation',
  'label.default.bug',
  'label.default.code',
  'label.default.content',
  'label.default.design',
  'label.default.development',
  'label.default.discovery',
  'label.default.feedback',
  'label.default.launch',
  'label.default.marketing',
  'label.default.new-contracts',
  'label.default.outreach',
  'label.default.priority',
  'label.default.product',
  'label.default.project',
  'label.default.research',
  'label.default.responses',
  'label.default.sales',
  'label.default.specs',
  'label.default.writing',
] as const

const VIEW_KEYS = [
  'sidebar.view.explore',
  'sidebar.view.exploreDesc',
  'sidebar.view.new',
  'sidebar.view.newDesc',
  'sidebar.view.overviewPurpose',
  'sidebar.view.plan',
  'sidebar.view.planDesc',
  'sidebar.view.planPurpose',
  'sidebar.view.processPurpose',
  'sidebar.view.processing',
  'sidebar.view.processingDesc',
] as const

const miss = ((key: string) => key) as typeof i18n.t

describe('session-status-config defaultEnglish leftover is i18n', () => {
  it('keeps catalog t() and drops English defaultEnglish / quoted defaultValue', () => {
    expect(source).toContain('t(key)')
    expect(source).toContain('`status.${state.id}`')
    expect(source).toContain('`label.default.${label.id}`')
    expect(source).toContain('`sidebar.view.${viewCatalogSlug(view.id)}`')
    expect(source).toContain("'in-progress'")
    expect(source).not.toContain('defaultEnglish')
    expect(source).not.toContain('DEFAULT_STATUS_ENGLISH_LABELS')
    expect(source).not.toContain('DEFAULT_LABEL_ENGLISH_NAMES')
    expect(source).not.toContain('DEFAULT_VIEW_ENGLISH_NAMES')
    expect(source).not.toContain('DEFAULT_VIEW_ENGLISH_DESCRIPTIONS')
    expect(source).not.toMatch(/defaultValue:\s*['"]/)
    expect(source).not.toMatch(/t\(`status\.\$\{[^}]+\}`,\s*['"]/)
    expect(source).not.toMatch(/t\(`label\.default\.\$\{[^}]+\}`,\s*['"]/)
    expect(source).not.toMatch(/t\(`sidebar\.view\.\$\{[^}]+\}`,\s*['"]/)
  })

  it('English locale keeps the previous seeded labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('status.todo')).toBe('Todo')
    expect(i18n.t('status.in-progress')).toBe('In Progress')
    expect(i18n.t('status.needs-review')).toBe('Needs Review')
    expect(i18n.t('label.default.bug')).toBe('Bug')
    expect(i18n.t('sidebar.view.new')).toBe('New')
    expect(i18n.t('sidebar.view.overviewPurpose')).toBe('Unread sessions that need a look')
    expect(resolveStatusDisplayLabel({ id: 'todo', label: 'Todo' }, i18n.t)).toBe('Todo')
    expect(resolveStatusDisplayLabel({ id: 'in-progress', label: 'In Progress' }, i18n.t)).toBe(
      'In Progress',
    )
    expect(resolveLabelDisplayName({ id: 'bug', name: 'Bug' }, i18n.t)).toBe('Bug')
    expect(resolveViewDisplayName({ id: 'view-new', name: 'New' }, i18n.t)).toBe('New')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(resolveStatusDisplayLabel({ id: 'todo', label: 'Todo' }, i18n.t)).toBe('К выполнению')
    expect(resolveStatusDisplayLabel({ id: 'in-progress', label: 'In Progress' }, i18n.t)).toBe(
      'В работе',
    )
    expect(resolveLabelDisplayName({ id: 'bug', name: 'Bug' }, i18n.t)).toBe('Баг')
    expect(resolveViewDisplayName({ id: 'view-new', name: 'New' }, i18n.t)).toBe('Новые')
    expect(
      resolveViewDisplayDescription(
        { id: 'view-new', description: 'Sessions with unread messages' },
        i18n.t,
      ),
    ).toBe('Непрочитанные сессии, которые стоит посмотреть')
    expect(i18n.t('status.todo')).not.toBe('Todo')
    expect(i18n.t('status.in-progress')).not.toBe('In Progress')
  })

  it('catalog miss uses user label or identifier, never the raw key', () => {
    expect(resolveStatusDisplayLabel({ id: 'todo', label: 'Todo' }, miss)).toBe('Todo')
    expect(resolveStatusDisplayLabel({ id: 'todo', label: '' }, miss)).toBe('todo')
    expect(resolveStatusDisplayLabel({ id: 'custom', label: 'Shipped' }, miss)).toBe('Shipped')
    expect(resolveLabelDisplayName({ id: 'bug', name: 'Bug' }, miss)).toBe('Bug')
    expect(resolveLabelDisplayName({ id: 'custom', name: '' }, miss)).toBe('custom')
    expect(resolveViewDisplayName({ id: 'view-new', name: 'New' }, miss)).toBe('New')
    expect(resolveViewDisplayName({ id: 'view-new', name: '' }, miss)).toBe('view-new')
    expect(resolveStatusDisplayLabel({ id: 'todo', label: 'Todo' }, miss)).not.toBe('status.todo')
    expect(resolveLabelDisplayName({ id: 'bug', name: 'Bug' }, miss)).not.toBe('label.default.bug')
    expect(resolveViewDisplayName({ id: 'view-new', name: 'New' }, miss)).not.toBe('sidebar.view.new')
  })

  it('keeps renamed defaults and includes in-progress in the built-in set', async () => {
    await setupI18n().changeLanguage('ru')
    expect(resolveStatusDisplayLabel({ id: 'todo', label: 'My Queue' }, i18n.t)).toBe('My Queue')
    expect(resolveLabelDisplayName({ id: 'bug', name: 'Defect' }, i18n.t)).toBe('Defect')
    expect(resolveViewDisplayName({ id: 'view-new', name: 'Inbox' }, i18n.t)).toBe('Inbox')
    expect(DEFAULT_STATUS_IDS.has('in-progress')).toBe(true)
  })

  it('all 12 locales already define the wired status/label/view keys', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([
      'ar.json',
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'hu.json',
      'ja.json',
      'ko.json',
      'pl.json',
      'ru.json',
      'zh-Hans.json',
      'zh-Hant.json',
    ])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of [...STATUS_KEYS, ...LABEL_KEYS, ...VIEW_KEYS]) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
