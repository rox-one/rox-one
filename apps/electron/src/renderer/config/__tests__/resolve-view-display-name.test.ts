import { describe, expect, it } from 'bun:test'
import { resolveViewDisplayName, resolveViewDisplayDescription } from '../session-status-config'

const t = ((key: string, fallback?: string) => {
  const map: Record<string, string> = {
    'sidebar.view.new': 'Новые',
    'sidebar.view.newDesc': 'Сессии с непрочитанными сообщениями',
    'sidebar.view.overviewPurpose': 'Непрочитанные сессии, которые стоит посмотреть',
  }
  return map[key] ?? fallback ?? key
}) as any

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
})
