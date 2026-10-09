/**
 * W1 — openui fence behaviour through <Markdown>:
 * dispatch, real rendering, error fallback, and `@ToAssistant` → onSendPrompt.
 *
 * The OpenUI chunk is imported statically below to warm it, so React.lazy's
 * Suspense boundary resolves within one flush (mirrors how the app preloads
 * on first use).
 */
import { useDomForFile, resetDom } from '../../primitives/__tests__/dom-env'
// Static side-effect imports warm the lazy chunk before any render, so
// React.lazy's Suspense boundary resolves within one flush (the app preloads
// the same module on first use).
import { MarkdownOpenUIBlock } from '../MarkdownOpenUIBlock'
import { extractOpenUIFormValues, openUIFormStateKey } from '../openui-form-state'
import '@openuidev/react-ui/genui-lib'
import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { initReactI18next, setI18n } from 'react-i18next'
import { setupI18n } from '@rox/shared/i18n'
import { Markdown } from '../Markdown'

useDomForFile()
setI18n(setupI18n([initReactI18next]))

/** Let pending microtasks, lazy chunks and effects settle. */
async function flush(times = 4): Promise<void> {
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
  await act(async () => { root.render(node) })
  await flush()
  return { container, root }
}

async function teardown(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => { root.unmount() })
  container.remove()
  resetDom()
}

const TABLE_PROGRAM = [
  '```openui',
  'root = Card([title, tbl])',
  'title = TextContent("Top Languages", "large-heavy")',
  'tbl = Table([Col("Language", langs), Col("Users (M)", users)])',
  'langs = ["Python", "TypeScript"]',
  'users = [15.7, 4.1]',
  '```',
].join('\n')

const BUTTON_PROGRAM = [
  '```openui',
  'root = Card([btns])',
  'btns = Buttons([Button("Send it", Action([@ToAssistant("Send it")]), "primary")])',
  '```',
].join('\n')

/**
 * Over budget by statement count (410 tiny statements + root), but cheap to
 * parse — so if the guard ever let it through, the Renderer would mount and
 * paint a `<table>`.
 */
const OVER_BUDGET_PROGRAM = (() => {
  const lines = ['root = Card([tbl])', 'tbl = Table([Col("Language", langs)])', 'langs = ["Python"]']
  for (let i = 0; i < 410; i += 1) lines.push(`s${i} = TextContent("x")`)
  return lines.join('\n')
})()

describe('Markdown openui fence', () => {
  it('dispatches ```openui to the openui block, not the plain code block', async () => {
    const { container, root } = await renderMarkdown(<Markdown>{TABLE_PROGRAM}</Markdown>)
    expect(container.querySelector('[data-ca-block-type="openui"]')).not.toBeNull()
    expect(container.querySelector('[data-ca-block-type="code"]')).toBeNull()
    expect(container.querySelector('pre')).toBeNull()
    await teardown(root, container)
  })

  it('renders a simple program (text + table) through openuiChatLibrary', async () => {
    const { container, root } = await renderMarkdown(<Markdown>{TABLE_PROGRAM}</Markdown>)
    const text = container.textContent ?? ''
    expect(text).toContain('Top Languages')
    expect(text).toContain('Python')
    expect(text).toContain('TypeScript')
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.textContent ?? '').toContain('Language')
    expect(table?.textContent ?? '').toContain('15.7')
    await teardown(root, container)
  })

  it('falls back to a notice + code block when the program is invalid', async () => {
    const invalid = ['```openui', 'root = Nope([t])', 't = TextContent("x")', '```'].join('\n')
    const { container, root } = await renderMarkdown(<Markdown isStreaming={false}>{invalid}</Markdown>)
    expect(container.querySelector('[data-ca-openui-notice="render-error"]')).not.toBeNull()
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent ?? '').toContain('root = Nope')
    await teardown(root, container)
  })

  it('sends the humanFriendlyMessage through onSendPrompt for a @ToAssistant button', async () => {
    const onSendPrompt = mock((_text: string) => {})
    const { container, root } = await renderMarkdown(
      <Markdown onSendPrompt={onSendPrompt}>{BUTTON_PROGRAM}</Markdown>,
    )
    const button = [...container.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Send it')
    expect(button).toBeDefined()
    await act(async () => { button!.click() })
    expect(onSendPrompt).toHaveBeenCalledTimes(1)
    expect((onSendPrompt.mock.calls[0]?.[0] ?? '').startsWith('Send it')).toBe(true)
    await teardown(root, container)
  })

  it('renders the code fallback (no notice) for an empty program', async () => {
    const { container, root } = await renderMarkdown(<Markdown isStreaming={false}>{'```openui\n\n```'}</Markdown>)
    expect(container.querySelector('[data-ca-block-type="openui"]')).not.toBeNull()
    expect(container.querySelector('[data-ca-openui-notice="render-error"]')).toBeNull()
    expect(container.querySelector('[data-ca-openui-loading]')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
    await teardown(root, container)
  })

  it('renders a plain code block when the openui preview is disabled', async () => {
    const { container, root } = await renderMarkdown(
      <Markdown disablePreviewBlocks={{ openui: true }}>{TABLE_PROGRAM}</Markdown>,
    )
    expect(container.querySelector('[data-ca-block-type="openui"]')).toBeNull()
    expect(container.querySelector('[data-ca-block-type="code"]')).not.toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
    await teardown(root, container)
  })

  it('shows notice + code fallback and never mounts the renderer for an over-budget program', async () => {
    const wrapper = ['```openui', OVER_BUDGET_PROGRAM, '```'].join('\n')
    const { container, root } = await renderMarkdown(<Markdown isStreaming={false}>{wrapper}</Markdown>)
    expect(container.querySelector('[data-ca-block-type="openui"]')).not.toBeNull()
    expect(container.querySelector('[data-ca-openui-notice="render-error"]')).not.toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
    // The program would paint a Table if the Renderer were mounted; it must not.
    expect(container.querySelector('table')).toBeNull()
    await teardown(root, container)
  })
})

describe('MarkdownOpenUIBlock helpers', () => {
  it('composes the form-state key from scope and block id', () => {
    expect(openUIFormStateKey('message-1', 'blk-abc')).toBe('message-1|blk-abc')
    expect(openUIFormStateKey(undefined, 'blk-abc')).toBe('|blk-abc')
  })

  it('distinguishes scopes so one message cannot hydrate another', () => {
    expect(openUIFormStateKey('message-1', 'blk-abc')).not.toBe(openUIFormStateKey('message-2', 'blk-abc'))
  })

  it('extracts the flat {field: value} map from a non-form store snapshot', () => {
    expect(extractOpenUIFormValues({
      name: { value: 'Ada', componentType: 'Input' },
      count: { value: 3, componentType: 'Number' },
      $binding: 42,
    })).toEqual({
      name: 'Ada',
      count: 3,
      $binding: 42,
    })
  })

  it('unwraps a form-named payload one level into the flat map', () => {
    expect(extractOpenUIFormValues({
      contact: {
        notes: { value: 'hello', componentType: 'Input' },
        amount: { value: 12, componentType: 'Number' },
      },
    })).toEqual({
      notes: 'hello',
      amount: 12,
    })
  })

  it('renders the code fallback (no notice) for an empty program body', async () => {
    const { container, root } = await renderMarkdown(
      <MarkdownOpenUIBlock code="" blockId="blk-empty" blockScope="message-1" isStreaming={false} />,
    )
    expect(container.querySelector('[data-ca-openui-notice="render-error"]')).toBeNull()
    expect(container.querySelector('[data-ca-openui-loading]')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
    await teardown(root, container)
  })

  it('does not mount the renderer for an over-budget program rendered directly', async () => {
    const { container, root } = await renderMarkdown(
      <MarkdownOpenUIBlock code={OVER_BUDGET_PROGRAM} blockId="blk-1" blockScope="message-1" isStreaming={false} />,
    )
    expect(container.querySelector('[data-ca-openui-notice="render-error"]')).not.toBeNull()
    expect(container.querySelector('[data-ca-openui-loading]')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
    await teardown(root, container)
  })
})