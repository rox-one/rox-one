import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { resetDom, useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import type { KnowledgeMapDto } from '@rox/shared/knowledge/knowledge-map-types'
import type { KnowledgeMapPanel as KnowledgeMapPanelComponent } from '../KnowledgeMapPanel'

/**
 * Render tests for the panel's empty and loaded states. The knowledge-map
 * settings pages have no DOM suite of their own, so this mirrors the happy-dom
 * harness of the sibling settings suites (AppearanceSettingsPage.test.ts):
 * happy-dom globals via `useDomForFile`, and module mocks for i18n and the
 * @rox/ui / @/components surfaces the panel pulls in.
 */
useDomForFile()

// Static import cannot work: Bun may evaluate react-dom (CJS) before the shared
// dom-env body installs `document`, which makes React pick its fallback input
// event path. Import it once the DOM exists.
const { createRoot } = await import('react-dom/client')

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', changeLanguage: async () => {} },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

mock.module('@rox/ui', () => ({
  Spinner: () => React.createElement('span', { 'data-testid': 'spinner' }),
  Markdown: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-markdown': true }, children),
  // Tooltip primitives are pass-throughs: no portal, no extra DOM, so the
  // rendered structure stays identical to the pre-Tooltip markup.
  Tooltip: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipContent: () => null,
}))

mock.module('@/components/settings', () => ({
  SettingsSegmentedControl: ({
    value,
    onValueChange,
    options,
  }: {
    value: string
    onValueChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) =>
    React.createElement(
      'div',
      { 'data-segmented': true, 'data-value': value },
      options.map((option) =>
        React.createElement(
          'button',
          { key: option.value, 'data-mode': option.value, onClick: () => onValueChange(option.value) },
          option.label,
        ),
      ),
    ),
}))

mock.module('@/components/ui/button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement('button', props, props.children),
}))

mock.module('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
}))

const emptyDto: KnowledgeMapDto = {
  generatedAt: '2026-10-09T00:00:00.000Z',
  rootLabel: 'Профиль',
  nodes: [],
  edges: [],
  stats: { files: 0, links: 0, areas: 0, bytes: 0, truncated: false, skipped: 0, total: 0 },
}

const loadedDto: KnowledgeMapDto = {
  generatedAt: '2026-10-09T00:00:00.000Z',
  rootLabel: 'Профиль',
  nodes: [
    { id: 'root', label: 'Профиль', area: 'root', kind: 'root', size: 0, linkCount: 1, relPath: null },
    { id: 'area:context', label: 'context', area: 'context', kind: 'area', size: 0, linkCount: 1, relPath: null },
    { id: 'context:soul.md', label: 'Soul', area: 'context', kind: 'doc', size: 12, linkCount: 1, relPath: 'soul.md' },
  ],
  edges: [
    { source: 'root', target: 'area:context', kind: 'member' },
    { source: 'area:context', target: 'context:soul.md', kind: 'member' },
  ],
  stats: { files: 1, links: 0, areas: 1, bytes: 12, truncated: false, skipped: 0, total: 1 },
}

let currentDto: KnowledgeMapDto = loadedDto
Object.assign(window, {
  electronAPI: {
    buildKnowledgeMap: () => Promise.resolve(currentDto),
    onContextDocsChanged: () => () => {},
    onMemoryChanged: () => () => {},
    onNotesChanged: () => () => {},
  },
})

let KnowledgeMapPanel: typeof KnowledgeMapPanelComponent

describe('KnowledgeMapPanel render', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeAll(async () => {
    // The module graph must load AFTER the i18n / @rox/ui / settings mocks above
    // are registered, so a static import cannot work here.
    KnowledgeMapPanel = (await import('../KnowledgeMapPanel')).default
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    const mounted = root
    root = null
    if (mounted) await act(async () => { mounted.unmount() })
    resetDom()
  })

  async function render(dto: KnowledgeMapDto): Promise<void> {
    currentDto = dto
    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(KnowledgeMapPanel, { workspaceId: 'workspace-A' }))
    })
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 0)
    await act(async () => {
      await promise
    })
  }

  it('renders the empty state when the corpus has no files', async () => {
    await render(emptyDto)
    expect(container.textContent).toContain('knowledgeMap.empty.title')
    expect(container.textContent).toContain('knowledgeMap.empty.body')
    expect(container.querySelector('svg[role="application"]')).toBeNull()
  })

  it('renders the graph, toolbar and honest stats when loaded', async () => {
    await render(loadedDto)
    expect(container.querySelector('svg[role="application"]')).not.toBeNull()
    expect(container.textContent).toContain('knowledgeMap.stats.files')
    expect(container.querySelector('[aria-label="knowledgeMap.refresh"]')).not.toBeNull()
    expect(container.querySelector('[data-mode="tree"]')).not.toBeNull()
    expect(container.textContent).not.toContain('knowledgeMap.empty.title')
  })
})