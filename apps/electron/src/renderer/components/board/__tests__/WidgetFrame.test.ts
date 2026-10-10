/**
 * WidgetFrame — sandbox posture, exact leased bytes and the message filter.
 *
 * Mounted in happy-dom so the real React effects (listener registration, stall
 * timer, iframe attributes) run against a live iframe. The leased document is
 * produced by the real `buildWidgetDocument`, so the "bridge bytes precede the
 * widget code" assertion is made against the exact bytes the server stores.
 * Timers are faked: the component's stall timeout is driven deterministically
 * instead of by wall-clock waits.
 *
 * No JSX here — the file is `.test.ts`, so elements are built with
 * `React.createElement`.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  WIDGET_BOOTSTRAP_MESSAGE_TYPE,
  WIDGET_READY_MESSAGE_TYPE,
  WIDGET_SIZE_MESSAGE_TYPE,
  buildWidgetDocument,
} from '@rox/shared/widgets/wrap'
import type {
  WidgetFrame as WidgetFrameComponent,
  WidgetFrameProps,
  acceptWidgetFrameMessage as acceptWidgetFrameMessageFn,
  parseWidgetFrameMessage as parseWidgetFrameMessageFn,
} from '../WidgetFrame'

useDomForFile()

mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let WidgetFrame: typeof WidgetFrameComponent
let acceptWidgetFrameMessage: typeof acceptWidgetFrameMessageFn
let parseWidgetFrameMessage: typeof parseWidgetFrameMessageFn
let MAX_WIDGET_FRAME_HEIGHT_PX: number

// A static import cannot work: the component graph must load AFTER the i18n
// mock is registered, or it captures the real react-i18next.
beforeAll(async () => {
  ;({ WidgetFrame, acceptWidgetFrameMessage, parseWidgetFrameMessage, MAX_WIDGET_FRAME_HEIGHT_PX } = await import('../WidgetFrame'))
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  resetDom()
})

const WIDGET_CODE = '<p id="widget-body">hello widget</p>'
const LEASED = buildWidgetDocument('Leased widget', WIDGET_CODE)

/** The leased frame under test, with a stall timeout far beyond the case. */
function leasedFrame(overrides: Partial<WidgetFrameProps> = {}): React.ReactElement {
  return React.createElement(WidgetFrame, {
    title: 'Leased widget',
    content: LEASED,
    renderTimeoutMs: 50_000,
    ...overrides,
  })
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

function frameOf(container: HTMLElement): HTMLIFrameElement {
  const node = container.querySelector('[data-testid="widget-frame"]')
  if (!node) throw new Error('widget frame not found')
  // Unchecked cast, allowed for a well-known DOM node the compiler cannot narrow.
  return node as HTMLIFrameElement
}

/** Dispatch a message with a chosen source/origin, exactly as the DOM would. */
function dispatchFrom(source: Window | null, origin: string, data: unknown): void {
  const event = new window.MessageEvent('message', { origin, data })
  Object.defineProperty(event, 'source', { value: source })
  window.dispatchEvent(event)
}

function postFromFrame(container: HTMLElement, origin: string, data: unknown): void {
  dispatchFrom(frameOf(container).contentWindow, origin, data)
}

describe('WidgetFrame sandbox posture', () => {
  it('sandboxes the leased document with allow-scripts only and no-referrer', async () => {
    const { container, root } = await render(leasedFrame())
    const frame = frameOf(container)

    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('srcdoc')).toBe(LEASED)
    expect(frame.srcdoc).toBe(LEASED)
    expect(frame.getAttribute('title')).toBe('Leased widget')

    await unmount(root)
  })

  it('emits the bridge bytes strictly before the widget code in the leased document', async () => {
    const { container, root } = await render(leasedFrame())
    const srcdoc = frameOf(container).getAttribute('srcdoc') ?? ''

    expect(srcdoc.indexOf(WIDGET_BOOTSTRAP_MESSAGE_TYPE)).toBeGreaterThanOrEqual(0)
    expect(srcdoc.indexOf(WIDGET_BOOTSTRAP_MESSAGE_TYPE)).toBeLessThan(srcdoc.indexOf(WIDGET_CODE))
    expect(srcdoc.indexOf(WIDGET_SIZE_MESSAGE_TYPE)).toBeLessThan(srcdoc.indexOf(WIDGET_CODE))
    expect(srcdoc).toContain("default-src 'none'")

    await unmount(root)
  })
})

describe('WidgetFrame message filter', () => {
  it('accepts only a well-formed size report', () => {
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: 120 })).toBe(120)
    // The bridge/channel-bearing messages are never consumed.
    expect(parseWidgetFrameMessage({ type: WIDGET_BOOTSTRAP_MESSAGE_TYPE })).toBeNull()
    expect(parseWidgetFrameMessage({ type: WIDGET_READY_MESSAGE_TYPE })).toBeNull()
    expect(parseWidgetFrameMessage({ type: 'rox:widget-action' })).toBeNull()
    // A legitimate zero height is content, not silence: the wrap reporter
    // sends it once and the host must accept it as a valid report.
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: 0 })).toBe(0)
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: '120' })).toBeNull()
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: Number.NaN })).toBeNull()
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: -1 })).toBeNull()
    expect(parseWidgetFrameMessage(null)).toBeNull()
    expect(parseWidgetFrameMessage('size')).toBeNull()
  })

  it('clamps hostile oversize heights to the exported bound instead of dropping them', () => {
    // Only the impossible magnitudes are hostile; the parse step still clamps
    // rather than discarding, so a legitimately tall widget is never dropped.
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: 1e308 })).toBe(
      MAX_WIDGET_FRAME_HEIGHT_PX,
    )
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: 1e21 })).toBe(
      MAX_WIDGET_FRAME_HEIGHT_PX,
    )
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: Number.MAX_VALUE })).toBe(
      MAX_WIDGET_FRAME_HEIGHT_PX,
    )
    // The bound itself passes unchanged — the boundary is inclusive.
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: MAX_WIDGET_FRAME_HEIGHT_PX })).toBe(
      MAX_WIDGET_FRAME_HEIGHT_PX,
    )
    // Non-finite and non-positive are still rejected outright.
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: Number.POSITIVE_INFINITY })).toBeNull()
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: Number.NEGATIVE_INFINITY })).toBeNull()
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: -1 })).toBeNull()
  })

  it('rejects a payload whose type/height are prototype-inherited, not own', () => {
    const inherited = Object.create({ type: WIDGET_SIZE_MESSAGE_TYPE, height: 31_337 }) as object
    expect(parseWidgetFrameMessage(inherited)).toBeNull()
    // A well-formed own-property object is still accepted.
    expect(parseWidgetFrameMessage({ type: WIDGET_SIZE_MESSAGE_TYPE, height: 120 })).toBe(120)
  })

  it('rejects messages that are not from this frame window or not opaque-origin', () => {
    const frameWindow = { name: 'frame' } as unknown as Window
    expect(
      acceptWidgetFrameMessage(
        { source: frameWindow, origin: 'null', data: { type: WIDGET_SIZE_MESSAGE_TYPE, height: 10 } },
        frameWindow,
      ),
    ).toBe(10)
    expect(acceptWidgetFrameMessage({ source: null, origin: 'null', data: {} }, null)).toBeNull()
    expect(acceptWidgetFrameMessage({ source: window, origin: 'null', data: {} }, frameWindow)).toBeNull()
    expect(
      acceptWidgetFrameMessage({ source: frameWindow, origin: 'https://evil.example', data: {} }, frameWindow),
    ).toBeNull()
    expect(
      acceptWidgetFrameMessage({ source: frameWindow, origin: 'null', data: { type: 'nope' } }, frameWindow),
    ).toBeNull()
  })

  it('applies a same-frame size report and ignores foreign, off-origin and malformed ones', async () => {
    const heights: number[] = []
    const { container, root } = await render(
      leasedFrame({ onContentHeight: height => heights.push(height) }),
    )
    expect(frameOf(container).style.height).toBe('100%')

    // A foreign window (here: the host document itself) advertising a size.
    dispatchFrom(window, 'null', { type: WIDGET_SIZE_MESSAGE_TYPE, height: 999 })
    // This frame, but a real origin — the sandbox never yields one.
    postFromFrame(container, 'http://localhost', { type: WIDGET_SIZE_MESSAGE_TYPE, height: 998 })
    // This frame, opaque origin, but the privileged bootstrap message — the
    // MessagePort is deliberately never claimed.
    postFromFrame(container, 'null', { type: WIDGET_BOOTSTRAP_MESSAGE_TYPE })
    // This frame, opaque origin, but a malformed payload.
    postFromFrame(container, 'null', { type: WIDGET_SIZE_MESSAGE_TYPE, height: -1 })

    await act(async () => {})
    expect(frameOf(container).style.height).toBe('100%')
    expect(heights).toEqual([])

    await act(async () => {
      postFromFrame(container, 'null', { type: WIDGET_SIZE_MESSAGE_TYPE, height: 240 })
    })
    expect(frameOf(container).style.height).toBe('240px')
    expect(heights).toEqual([240])

    await unmount(root)
  })

  it('clamps an oversize same-frame size report at the host layout boundary', async () => {
    const heights: number[] = []
    const { container, root } = await render(
      leasedFrame({ onContentHeight: height => heights.push(height) }),
    )

    await act(async () => {
      postFromFrame(container, 'null', { type: WIDGET_SIZE_MESSAGE_TYPE, height: 1e21 })
    })

    expect(frameOf(container).style.height).toBe(`${MAX_WIDGET_FRAME_HEIGHT_PX}px`)
    expect(heights).toEqual([MAX_WIDGET_FRAME_HEIGHT_PX])

    await unmount(root)
  })
})

describe('WidgetFrame failure chrome', () => {
  it('replaces a frame that never reports content with typed runtime-error chrome', async () => {
    const { container, root } = await render(leasedFrame({ renderTimeoutMs: 5_000 }))
    expect(container.querySelector('[data-testid="widget-frame"]')).not.toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(5_001)
    })

    const chrome = container.querySelector('[data-testid="widget-frame-failure"]')
    expect(chrome?.getAttribute('data-failure-code')).toBe('runtime-error')
    expect(chrome?.getAttribute('role')).toBe('alert')
    expect(container.textContent).toContain('board.widget.frame.runtimeErrorTitle')
    expect(container.querySelector('[data-testid="widget-frame"]')).toBeNull()

    await unmount(root)
  })

  it('keeps the frame once a size report lands before the stall timeout', async () => {
    const { container, root } = await render(leasedFrame({ renderTimeoutMs: 5_000 }))
    await act(async () => {
      postFromFrame(container, 'null', { type: WIDGET_SIZE_MESSAGE_TYPE, height: 128 })
    })
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    expect(container.querySelector('[data-testid="widget-frame-failure"]')).toBeNull()
    expect(frameOf(container).style.height).toBe('128px')

    await unmount(root)
  })

  it('treats a zero height report as content: no chrome, zero-height box', async () => {
    const heights: number[] = []
    const { container, root } = await render(
      leasedFrame({ renderTimeoutMs: 5_000, onContentHeight: height => heights.push(height) }),
    )
    await act(async () => {
      postFromFrame(container, 'null', { type: WIDGET_SIZE_MESSAGE_TYPE, height: 0 })
    })
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    // The zero report cleared the stall timeout, so no false failure chrome.
    expect(container.querySelector('[data-testid="widget-frame-failure"]')).toBeNull()
    expect(frameOf(container).style.height).toBe('0px')
    expect(heights).toEqual([0])

    await unmount(root)
  })

  it('renders load-failure chrome when the frame itself errors', async () => {
    const { container, root } = await render(leasedFrame())
    await act(async () => {
      frameOf(container).dispatchEvent(new Event('error', { bubbles: true }))
    })

    const chrome = container.querySelector('[data-testid="widget-frame-failure"]')
    expect(chrome?.getAttribute('data-failure-code')).toBe('frame-unavailable')

    await unmount(root)
  })
})