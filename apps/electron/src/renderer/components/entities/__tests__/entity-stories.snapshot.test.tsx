/**
 * W1-08 (#1505) — story snapshots: every entity/primitive story rendered in
 * light/dark × RU/EN. Markup snapshots stand in for pixel screenshots (no
 * GUI on CI boxes); theme is applied through the `.dark` token scope.
 */
import { renderMarkup, setupEntityTestEnv } from './test-env'
import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { entityPrimitiveComponents } from '@/playground/registry/entity-primitives'

setupEntityTestEnv()

const THEMES = ['light', 'dark'] as const
const LANGS = ['ru', 'en'] as const

describe('W1-08 stories', () => {
  it('registers a story for every UI-SPEC §4 primitive', () => {
    expect(entityPrimitiveComponents.map((entry) => entry.name)).toEqual([
      'EntityChip',
      'EntityHoverCard',
      'EntityCard',
      'EntityPicker',
      'BacklinksPanel',
      'StatusBadge',
      'ProgressBar / PieProgress',
      'PersonField',
      'ContextualDatePicker',
      'PrivacyField',
      'ReactionsBar',
      'CommentsThread',
      'ActivityTimeline',
      'SubscribersPicker',
      'GanttView',
      'TreeTable',
    ])
    for (const entry of entityPrimitiveComponents) {
      expect(entry.id.startsWith('w1-08-')).toBe(true)
      expect(entry.category).toBe('Entity Lists')
      expect(entry.description.length).toBeGreaterThan(10)
    }
  })

  for (const entry of entityPrimitiveComponents) {
    const variants = entry.variants?.length ? entry.variants : [{ name: 'default', props: {} }]
    for (const variant of variants) {
      for (const theme of THEMES) {
        for (const lang of LANGS) {
          it(`${entry.id} / ${variant.name} / ${theme} / ${lang}`, async () => {
            const defaults = Object.fromEntries(entry.props.map((prop) => [prop.name, prop.defaultValue]))
            const Component = entry.component
            const html = await renderMarkup(<Component {...defaults} {...variant.props} />, { lang, theme })
            expect(html).not.toContain('entities.ui.')
            expect(html).toMatchSnapshot()
          })
        }
      }
    }
  }

  it('renders real Russian by default and English after switching', async () => {
    const chip = entityPrimitiveComponents.find((entry) => entry.id === 'w1-08-entity-chip')!.component
    expect(await renderMarkup(<>{React.createElement(chip, { state: 'restricted' })}</>, { lang: 'ru' })).toContain('Нет доступа')
    expect(await renderMarkup(<>{React.createElement(chip, { state: 'restricted' })}</>, { lang: 'en' })).toContain('Restricted')
    const picker = entityPrimitiveComponents.find((entry) => entry.id === 'w1-08-entity-picker')!.component
    expect(await renderMarkup(React.createElement(picker, {}), { lang: 'ru' })).toContain('Связать элемент Rox…')
    const backlinks = entityPrimitiveComponents.find((entry) => entry.id === 'w1-08-backlinks')!.component
    expect(await renderMarkup(React.createElement(backlinks, {}), { lang: 'ru' })).toContain('Упоминается в')
  })
})
