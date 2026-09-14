import { describe, expect, it } from 'bun:test'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import { resolveViewDisplayName, resolveViewDisplayDescription } from '../session-status-config'

const t = ((key: string, fallback?: string) => {
  const map: Record<string, string> = {
    'sidebar.view.new': 'Новые',
    'sidebar.view.newDesc': 'Сессии с непрочитанными сообщениями',
    'sidebar.view.overviewPurpose': 'Непрочитанные сессии, которые стоит посмотреть',
  }
  return map[key] ?? fallback ?? key
}) as typeof i18n.t

const miss = ((key: string) => key) as typeof i18n.t

describe('resolveViewDisplayName', () => {
  it('translates default English seed', () => {
    expect(resolveViewDisplayName({ id: 'view-new', name: 'New' }, t)).toBe('Новые')
  })
  it('keeps renamed views', () => {
    expect(resolveViewDisplayName({ id: 'view-new', name: 'Inbox' }, t)).toBe('Inbox')
  })
  it('passes through custom ids', () => {
    expect(resolveViewDisplayName({ id: 'view-custom', name: 'Mine' }, t)).toBe('Mine')
  })
})

describe('resolveViewDisplayDescription', () => {
  it('translates default English description', () => {
    expect(
      resolveViewDisplayDescription(
        { id: 'view-new', description: 'Sessions with unread messages' },
        t,
      ),
    ).toBe('Непрочитанные сессии, которые стоит посмотреть')
  })

  it('catalog miss keeps the user description, never the raw key', () => {
    expect(
      resolveViewDisplayDescription(
        { id: 'view-new', description: 'Sessions with unread messages' },
        miss,
      ),
    ).toBe('Sessions with unread messages')
    expect(
      resolveViewDisplayDescription(
        { id: 'view-new', description: 'Sessions with unread messages' },
        miss,
      ),
    ).not.toBe('sidebar.view.overviewPurpose')
  })
})

describe('resolveViewDisplayName English catalog', () => {
  it('English locale keeps the previous view name', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('sidebar.view.new')).toBe('New')
    expect(resolveViewDisplayName({ id: 'view-new', name: 'New' }, i18n.t)).toBe('New')
  })
})
