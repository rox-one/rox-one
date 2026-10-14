import { useDomForFile, resetDom } from '../../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import type { Message } from '../../../../../shared/types'
import { TrajectoryView } from '../TrajectoryView'

useDomForFile()

let i18n: I18n
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', keySeparator: false, resources: { en: { translation: en } } })
})

let roots: Root[] = []
afterEach(async () => {
  await act(async () => { for (const r of roots) r.unmount() })
  roots = []
  resetDom()
})

const messages = [
  { id: 'u1', role: 'user', content: 'hello', timestamp: 1000 },
  { id: 'a1', role: 'assistant', content: 'checking', timestamp: 1100 },
  { id: 't1', role: 'tool', content: '', toolName: 'Bash', toolInput: { command: 'ls' }, toolResult: 'boom', toolStatus: 'error', isError: true, timestamp: 1200 },
] as Message[]

async function mount(props: React.ComponentProps<typeof TrajectoryView>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><TrajectoryView {...props} /></I18nextProvider>) })
  return container
}

describe('TrajectoryView', () => {
  it('renders toolbar, three lanes, spans and ledger rows', async () => {
    const c = await mount({ messages })
    expect(c.querySelector('[role="toolbar"]')?.textContent).toContain('Duration')
    expect(c.textContent).toContain('Input')
    expect(c.textContent).toContain('Model')
    expect(c.querySelectorAll('[data-timeline-span]').length).toBe(3)
    expect(c.querySelector('[data-timeline-span="tool"]')?.getAttribute('data-error')).toBe('true')
    const toolRow = c.querySelector('[role="row"][data-kind="tool"]')!
    expect(toolRow.textContent).toContain('Bash {"command":"ls"}')
    expect(toolRow.textContent).toContain('boom')
    expect(toolRow.textContent).toContain('TOOL')
  })

  it('opens the inspector on row click and jumps to chat', async () => {
    const opened: string[] = []
    const c = await mount({ messages, onOpenMessage: (id) => opened.push(id) })
    await act(async () => { (c.querySelector('[role="row"][data-kind="tool"]') as HTMLElement).click() })
    const details = c.querySelector('section[aria-label="Event details"]')!
    expect(details.textContent).toContain('Failed')
    expect(details.textContent).toContain('"command": "ls"')
    await act(async () => { (Array.from(details.querySelectorAll('button')).find((b) => b.textContent === 'Open in chat') as HTMLElement).click() })
    expect(opened).toEqual(['t1'])
  })

  it('search and calls toggle filter the ledger', async () => {
    const c = await mount({ messages })
    const input = c.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      input.focus()
      setter.call(input, 'checking')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }))
    })
    expect(c.querySelectorAll('[role="row"][data-kind]').length).toBe(1)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }))
    })
    const calls = Array.from(c.querySelectorAll('[role="toolbar"] button')).find((b) => b.textContent?.includes('Calls')) as HTMLElement
    await act(async () => { calls.click() })
    expect(c.querySelector('[role="row"][data-kind="tool"]')).toBeNull()
  })

  it('shows the empty state', async () => {
    const c = await mount({ messages: [] })
    expect(c.textContent).toContain('No events in this session yet')
    expect(c.textContent).toContain('No timing data')
  })
})
