/**
 * WidgetCard — mount lifecycle against the frozen board widget RPCs.
 *
 * Mounted in happy-dom against a hand-rolled `window.electronAPI`, so the real
 * mount/release/refresh effects run: a mount renders the leased document in the
 * sandboxed frame, unmount releases the ticket, a `board:changed` advance
 * re-leases, and a stale-ticket refusal retries exactly once before settling.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { buildWidgetDocument } from '@rox/shared/widgets/wrap'
import type { BoardChangedPush } from '../../../../shared/types'
import type { WidgetCard as WidgetCardComponent } from '../WidgetCard'

useDomForFile()

mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let WidgetCard: typeof WidgetCardComponent

// A static import cannot work: the component graph must load AFTER the i18n
// mock is registered, or it captures the real react-i18next.
beforeAll(async () => {
  ;({ WidgetCard } = await import('../WidgetCard'))
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  resetDom()
})

const WIDGET_CODE = '<p id="card-widget">card widget</p>'
const LEASED = buildWidgetDocument('Card widget', WIDGET_CODE)

/** RPC failures reach the renderer as `{ code, message }` objects, not Errors. */
function codedError(code: string, message: string): unknown {
  return { code, message }
}

type MountResult = { ticket: string; content: string; revision: number }

interface Harness {
  mountCalls: Array<{ widgetId: string }>
  releaseCalls: string[]
  emit: (payload: BoardChangedPush) => void
}

function installHostApi(mount: (args: { widgetId: string }) => Promise<MountResult>): Harness {
  const mountCalls: Array<{ widgetId: string }> = []
  const releaseCalls: string[] = []
  let listener: ((payload: BoardChangedPush) => void) | null = null
  // Named const because the frozen ElectronAPI is only partially stubbed here.
  const host = window as unknown as { electronAPI: Partial<Window['electronAPI']> }
  host.electronAPI = {
    mountBoardWidget: async args => {
      mountCalls.push({ widgetId: args.widgetId })
      return mount(args)
    },
    releaseBoardWidget: async ({ ticket }) => {
      releaseCalls.push(ticket)
      return { released: true }
    },
    onBoardChanged: callback => {
      listener = callback
      return () => {
        listener = null
      }
    },
  }
  return { mountCalls, releaseCalls, emit: payload => listener?.(payload) }
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount()
  })
}

describe('WidgetCard mount lifecycle', () => {
  it('mounts the widget by id and renders the leased bytes in the sandbox frame', async () => {
    let tickets = 0
    const host = installHostApi(async () => ({ ticket: `ticket-${++tickets}`, content: LEASED, revision: 1 }))
    const { container, root } = await render(
      <WidgetCard widgetId="burndown" title="Burndown" renderTimeoutMs={50_000} />,
    )

    expect(host.mountCalls).toEqual([{ widgetId: 'burndown' }])
    const frame = container.querySelector('[data-testid="widget-frame"]')
    expect(frame?.getAttribute('srcdoc')).toBe(LEASED)
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('title')).toBe('Burndown')

    await unmount(root)
  })

  it('releases the ticket when the card unmounts', async () => {
    const host = installHostApi(async () => ({ ticket: 'ticket-1', content: LEASED, revision: 1 }))
    const { root } = await render(<WidgetCard widgetId="burndown" renderTimeoutMs={50_000} />)

    expect(host.releaseCalls).toEqual([])
    await unmount(root)
    expect(host.releaseCalls).toEqual(['ticket-1'])
  })

  it('renders typed unavailable chrome for a NOT_FOUND mount and never retries', async () => {
    const host = installHostApi(async () => {
      throw codedError('NOT_FOUND', 'Board widget unavailable')
    })
    const { container, root } = await render(<WidgetCard widgetId="missing" renderTimeoutMs={50_000} />)

    const refusal = container.querySelector('[data-testid="widget-card-refusal"]')
    expect(refusal?.getAttribute('data-reason')).toBe('unavailable')
    expect(host.mountCalls).toHaveLength(1)
    expect(host.releaseCalls).toEqual([])

    await unmount(root)
  })

  it('retries a stale-ticket refusal exactly once, then succeeds with a fresh ticket', async () => {
    let attempts = 0
    const host = installHostApi(async () => {
      attempts += 1
      if (attempts === 1) throw codedError('WIDGET_TICKET_REFUSED', 'Widget ticket refused')
      return { ticket: 'fresh-ticket', content: LEASED, revision: 1 }
    })
    const { container, root } = await render(<WidgetCard widgetId="burndown" renderTimeoutMs={50_000} />)

    expect(host.mountCalls).toHaveLength(2)
    expect(container.querySelector('[data-testid="widget-frame"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="widget-card-refusal"]')).toBeNull()

    await unmount(root)
  })

  it('settles in typed refusal chrome when the stale-ticket refusal repeats', async () => {
    const host = installHostApi(async () => {
      throw codedError('WIDGET_TICKET_REFUSED', 'Widget ticket refused')
    })
    const { container, root } = await render(<WidgetCard widgetId="burndown" renderTimeoutMs={50_000} />)

    expect(host.mountCalls).toHaveLength(2)
    const refusal = container.querySelector('[data-testid="widget-card-refusal"]')
    expect(refusal?.getAttribute('data-reason')).toBe('ticket-refused')

    await unmount(root)
  })

  it('re-leases on a newer board revision and releases the superseded ticket', async () => {
    let revision = 0
    const host = installHostApi(async () => {
      revision += 1
      return { ticket: `ticket-${revision}`, content: LEASED, revision }
    })
    const { container, root } = await render(<WidgetCard widgetId="burndown" renderTimeoutMs={50_000} />)
    expect(host.mountCalls).toHaveLength(1)

    await act(async () => {
      host.emit({ widgetId: 'burndown', revision: 2 })
    })

    expect(host.mountCalls).toHaveLength(2)
    expect(host.releaseCalls).toEqual(['ticket-1'])
    expect(container.querySelector('[data-testid="widget-frame"]')?.getAttribute('srcdoc')).toBe(LEASED)

    await unmount(root)
  })

  it('ignores board changes for other widgets or non-advancing revisions', async () => {
    const host = installHostApi(async () => ({ ticket: 'ticket-1', content: LEASED, revision: 3 }))
    const { root } = await render(<WidgetCard widgetId="burndown" renderTimeoutMs={50_000} />)

    await act(async () => {
      host.emit({ widgetId: 'other', revision: 9 })
      host.emit({ widgetId: 'burndown', revision: 3 })
    })

    expect(host.mountCalls).toHaveLength(1)

    await unmount(root)
  })

  it('renders nothing without a widget id', async () => {
    const host = installHostApi(async () => ({ ticket: 'ticket-1', content: LEASED, revision: 1 }))
    const { container, root } = await render(<WidgetCard widgetId={null} />)

    expect(container.querySelector('[data-testid="widget-frame"]')).toBeNull()
    expect(container.querySelector('[data-testid="widget-card-refusal"]')).toBeNull()
    expect(host.mountCalls).toHaveLength(0)

    await unmount(root)
  })
})