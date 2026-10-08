/**
 * W1-08 (#1505) — restricted entities never leak their title.
 */
import { flush, mount, renderMarkup, resetDom } from './test-env'
import { afterEach, describe, expect, it } from 'bun:test'
import type { EntityPreview } from '@rox/core/entities'
import { EntityChip } from '../EntityChip'
import { EntityCard } from '../EntityCard'
import { EntityHoverCard } from '../EntityHoverCard'
import { setEntityDataSource, type EntityDataSource } from '../entity-data-source'
import { resetEntityPreviewStores } from '../use-entity-preview'
import { EntityWorkspaceContext } from '../entity-context'
import { FIXTURE_RESTRICTED, FIXTURE_SECRET_REF, FIXTURE_SECRET_TITLE, FIXTURE_TOMBSTONE } from '../fixtures'

afterEach(() => {
  setEntityDataSource(null)
  resetEntityPreviewStores()
  resetDom()
})

/** A misbehaving resolver that sends the title along with `no_access`. */
function leakySource(status: EntityPreview['status']): EntityDataSource {
  return {
    async resolve(_ws, refs) {
      return refs.map((ref) => ({
        ref,
        status,
        title: FIXTURE_SECRET_TITLE,
        kindLabel: 'Project',
        icon: 'folder-kanban',
        authority: 'workspace' as const,
        fields: [{ id: 'owner', label: 'Owner', value: 'Secret Owner' }],
        etag: 'leak',
      }))
    },
    async backlinks() { return { links: [] } },
    async search() { return [] },
    onLinksChanged() { return () => {} },
  }
}

describe('restricted previews («Нет доступа»)', () => {
  it('chip shows a lock + «Нет доступа» and no title, even with a stored label', async () => {
    const html = await renderMarkup(<EntityChip entityRef={FIXTURE_SECRET_REF} label="Old label" preview={FIXTURE_RESTRICTED} previewsEnabled={false} />)
    expect(html).toContain('Нет доступа')
    expect(html).toContain('lucide-lock')
    expect(html).not.toContain(FIXTURE_SECRET_TITLE)
    expect(html).not.toContain('Old label')
    expect(html).toContain('data-entity-status="no_access"')
  })

  it('card and hover card render the restricted body only', async () => {
    for (const element of [
      <EntityCard entityRef={FIXTURE_SECRET_REF} preview={FIXTURE_RESTRICTED} />,
      <EntityHoverCard entityRef={FIXTURE_SECRET_REF} preview={FIXTURE_RESTRICTED} />,
    ]) {
      const ru = await renderMarkup(element, { lang: 'ru' })
      expect(ru).toContain('Нет доступа: Проект')
      expect(ru).toContain('У вас нет прав на просмотр этого объекта.')
      expect(ru).not.toContain(FIXTURE_SECRET_TITLE)
      const en = await renderMarkup(element, { lang: 'en' })
      expect(en).toContain('No access: Project')
    }
  })

  it('tombstones render «Удалено» struck through, without the title', async () => {
    const html = await renderMarkup(<EntityChip entityRef={FIXTURE_TOMBSTONE.ref!} label="Draft" preview={FIXTURE_TOMBSTONE} previewsEnabled={false} />)
    expect(html).toContain('Удалено')
    expect(html).toContain('line-through')
    expect(html).not.toContain('Draft')
  })

  for (const status of ['no_access', 'tombstone', 'unavailable'] as const) {
    it(`redacts a leaky resolver response (${status}) before rendering`, async () => {
      setEntityDataSource(leakySource(status))
      const mounted = await mount(
        <EntityWorkspaceContext.Provider value="ws-1">
          <EntityChip entityRef={FIXTURE_SECRET_REF} previewsEnabled />
          <EntityCard entityRef={FIXTURE_SECRET_REF} preview={null} />
        </EntityWorkspaceContext.Provider>,
      )
      await flush()
      await flush()
      const html = mounted.container.innerHTML
      await mounted.unmount()
      expect(html).toContain(`data-entity-status="${status}"`)
      expect(html).not.toContain(FIXTURE_SECRET_TITLE)
      expect(html).not.toContain('Secret Owner')
    })
  }

  it('an ok preview does show the resolved title (positive control)', async () => {
    setEntityDataSource(leakySource('ok'))
    const mounted = await mount(
      <EntityWorkspaceContext.Provider value="ws-1">
        <EntityChip entityRef={FIXTURE_SECRET_REF} previewsEnabled />
      </EntityWorkspaceContext.Provider>,
    )
    await flush()
    await flush()
    const html = mounted.container.innerHTML
    await mounted.unmount()
    expect(html).toContain(FIXTURE_SECRET_TITLE)
  })
})
