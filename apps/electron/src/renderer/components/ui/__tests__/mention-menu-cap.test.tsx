/**
 * The @-mention menu shows at most 50 items (ADR-0023 §7); the rest of a large
 * skill catalog stays reachable by typing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import type { InlineMentionMenuProps, MentionItem, MentionSection } from '../mention-menu'

useDomForFile()

// mention-menu.tsx transitively imports pdfjs-dist via renderer component chain.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let InlineMentionMenu: (props: InlineMentionMenuProps) => React.ReactElement | null
let i18n: I18n
let stubbedScrollIntoView = false

beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', keySeparator: false, resources: { en: { translation: {} } } })
  InlineMentionMenu = (await import('../mention-menu')).InlineMentionMenu
  if (typeof (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView !== 'function') {
    HTMLElement.prototype.scrollIntoView = () => {}
    stubbedScrollIntoView = true
  }
})

afterAll(() => {
  if (stubbedScrollIntoView) delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

const skillItems: MentionItem[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: `skill-${index}`,
  type: 'skill',
  label: `skill-${index}`,
}))
const sourceItems: MentionItem[] = ['github', 'linear', 'slack'].map((slug) => ({
  id: slug,
  type: 'source',
  label: slug,
}))
const sections: MentionSection[] = [
  { id: 'skills', label: 'Skills', items: skillItems },
  { id: 'sources', label: 'Sources', items: sourceItems },
]

async function renderMenu(filter: string): Promise<string[]> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  container = host
  await act(async () => {
    root = createRoot(host)
    root.render(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(InlineMentionMenu, {
          open: true,
          onOpenChange: () => {},
          sections,
          onSelect: () => {},
          filter,
          position: { x: 100, y: 100 },
        }),
      ),
    )
  })
  return Array.from(host.querySelectorAll<HTMLElement>('[data-selected]')).map(
    (row) => row.querySelector<HTMLElement>('span[title]')?.title ?? '',
  )
}

describe('InlineMentionMenu cap', () => {
  it('shows 50 items for an unfiltered 10,000-skill catalog and keeps every source', async () => {
    const labels = await renderMenu('')
    expect(labels).toHaveLength(50)
    expect(labels.slice(0, 3)).toEqual(['skill-0', 'skill-1', 'skill-2'])
    // 3 sources fit under an even share of 25, so skills get the other 47.
    expect(labels.slice(-3)).toEqual(['github', 'linear', 'slack'])
    expect(labels[46]).toBe('skill-46')
  })

  it('caps a broad filter at 50 matches in ranking order', async () => {
    // "skill-1" matches skill-1, skill-10..19, skill-100..199 and skill-1000..1999 (1,111 skills).
    const labels = await renderMenu('skill-1')
    expect(labels).toHaveLength(50)
    expect(labels.slice(0, 3)).toEqual(['skill-1', 'skill-10', 'skill-100'])
  })

  it('reaches a skill beyond the cap by typing', async () => {
    expect(await renderMenu('skill-9999')).toEqual(['skill-9999'])
  })
})
