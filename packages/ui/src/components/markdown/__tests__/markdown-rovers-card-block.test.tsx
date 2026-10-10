/**
 * Rovers Slice A — the ```rovers-card fence through <Markdown>.
 *
 * Dispatch, localized rendering (ru default), the verified badge and the
 * «Инструкция» link, and the absence of any deploy control. An unreadable
 * payload falls back to the plain code block.
 */
import { useDomForFile, resetDom } from '../../primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { initReactI18next, setI18n } from 'react-i18next'
import { setupI18n } from '@rox/shared/i18n'
import { Markdown } from '../Markdown'
import { parseRoversCardPayload, pickLocalized } from '../rovers-card'
import { MarkdownRoversCardBlock } from '../MarkdownRoversCardBlock'

useDomForFile()
setI18n(setupI18n([initReactI18next]))

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 0)
      await promise
    })
  }
}

async function renderMarkdown(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  await flush()
  return { container, root }
}

async function teardown(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  resetDom()
}

const ENTRY = {
  id: 'qdrant',
  name: 'Qdrant',
  category: 'vector-db',
  tagline: { ru: 'Векторная база с фильтрацией', en: 'Vector database with filtering' },
  description: { ru: 'REST и gRPC API для поиска.', en: 'REST and gRPC search API.' },
  icon: 'icons/qdrant.svg',
  spdx: 'Apache-2.0',
  homepage: 'https://qdrant.tech',
  verified: true,
  deploy: { kind: 'none' as const },
}

const FENCE = ['```rovers-card', JSON.stringify(ENTRY, null, 2), '```'].join('\n')

describe('MarkdownRoversCardBlock', () => {
  it('parses a valid payload and rejects a partial one', () => {
    const ok = parseRoversCardPayload(JSON.stringify(ENTRY))
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.entry.id).toBe('qdrant')
      expect(pickLocalized(ok.entry.tagline, 'ru')).toBe('Векторная база с фильтрацией')
      expect(ok.entry.deploy.kind).toBe('none')
    }
    expect(parseRoversCardPayload('{"id":"x"').ok).toBe(false)
  })

  it('dispatches ```rovers-card to the card block, not the code block', async () => {
    const { container, root } = await renderMarkdown(<Markdown>{FENCE}</Markdown>)
    expect(container.querySelector('[data-ca-block-type="rovers-card"]')).not.toBeNull()
    expect(container.querySelector('[data-ca-block-type="code"]')).toBeNull()
    await teardown(root, container)
  })

  it('renders ru locale copy, verified badge and the «Инструкция» link', async () => {
    const { container, root } = await renderMarkdown(<Markdown>{FENCE}</Markdown>)
    const text = container.textContent ?? ''
    expect(text).toContain('Qdrant')
    expect(text).toContain('Векторная база с фильтрацией')
    expect(text).toContain('REST и gRPC API для поиска.')
    expect(text).toContain('Векторные базы')
    expect(text).toContain('Проверено Rovers')
    expect(text).toContain('Apache-2.0')
    const link = container.querySelector('a[href="https://qdrant.tech"]')
    expect(link).not.toBeNull()
    expect(link?.textContent ?? '').toContain('Инструкция')
    await teardown(root, container)
  })

  it('has no deploy button or deploy action anywhere', async () => {
    const { container, root } = await renderMarkdown(<Markdown>{FENCE}</Markdown>)
    expect(container.querySelector('button')).toBeNull()
    const text = (container.textContent ?? '').toLowerCase()
    expect(text).not.toContain('развернуть')
    expect(text).not.toContain('deploy')
    expect(text).not.toContain('установить')
    await teardown(root, container)
  })

  it('falls back to a notice + code block for an unreadable payload', async () => {
    const broken = ['```rovers-card', '{ not json', '```'].join('\n')
    const { container, root } = await renderMarkdown(<Markdown>{broken}</Markdown>)
    expect(container.querySelector('[data-ca-rovers-notice="invalid-payload"]')).not.toBeNull()
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent ?? '').toContain('not json')
    await teardown(root, container)
  })

  it('uses the en side when the active locale is not ru', () => {
    const entry = parseRoversCardPayload(JSON.stringify(ENTRY))
    expect(entry.ok).toBe(true)
    if (!entry.ok) return
    expect(pickLocalized(entry.entry.description, 'en')).toBe('REST and gRPC search API.')
  })

  it('renders the block component directly', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<MarkdownRoversCardBlock code={JSON.stringify(ENTRY)} />)
    })
    await flush()
    expect(container.textContent ?? '').toContain('Qdrant')
    expect(container.querySelector('button')).toBeNull()
    await teardown(root, container)
  })
})