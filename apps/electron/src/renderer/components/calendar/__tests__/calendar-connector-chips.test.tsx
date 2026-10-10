import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

useDomForFile()

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      const value = key.startsWith('calendar.provider.') ? key.slice('calendar.provider.'.length) : key
      return values ? `${key}:${values.provider}` : value
    },
  }),
}))

mock.module('@rox/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

import { CALENDAR_PROVIDERS, CalendarConnectorChips } from '../CalendarConnectorChips'

function disabledCount(html: string): number {
  return (html.match(/<button[^>]*disabled=""/g) ?? []).length
}

/** The opening `<button …>` tag carrying `aria-label`. */
function buttonTagFor(html: string, ariaLabel: string): string {
  const match = html.match(new RegExp(`<button[^>]*aria-label="${ariaLabel}"[^>]*>`))
  if (!match) throw new Error(`no button with aria-label "${ariaLabel}"`)
  return match[0]
}

async function render(node: ReactNode): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

function appleButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'appleCalendar')
  if (!button) throw new Error('Apple Calendar chip not found')
  return button
}

let mounted: Root | null = null
afterEach(async () => {
  if (mounted) await act(async () => { mounted!.unmount() })
  mounted = null
  document.body.innerHTML = ''
})

describe('calendar connector controls', () => {
  it('keeps every provider disabled with an honest hint by default', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips />)

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length)
    expect(html).toContain('calendar.googleUnavailableHint:google')
    expect(html).toContain('calendar.appleCalendarUnavailableHint:appleCalendar')
    for (const provider of CALENDAR_PROVIDERS.filter((item) => item !== 'google' && item !== 'appleCalendar')) {
      expect(html).toContain(`calendar.connectionUnavailable:${provider}`)
    }
  })

  it('enables the Google chip with a connect hint when the connector is disconnected', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips googleStatus="disconnected" />)

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length - 1)
    expect(html).toContain('calendar.googleConnectHint')
    expect(html).not.toContain('calendar.googleUnavailableHint')
  })

  it('enables the Google chip with a disconnect hint when the connector is connected', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips googleStatus="connected" />)

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length - 1)
    expect(html).toContain('calendar.googleConnectedHint')
  })

  it('disables the Google chip while a connect request is in flight', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips googleStatus="disconnected" googleBusy />)

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length)
  })

  it('shows the Apple unavailable hint without a live helper and keeps the chip disabled', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips appleStatus="unavailable" />)
    expect(buttonTagFor(html, 'calendar.appleCalendarUnavailableHint:appleCalendar')).toContain('disabled=""')
  })

  it('keeps the Apple chip disabled with a denial hint when macOS access was denied', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips appleStatus="denied" />)
    expect(buttonTagFor(html, 'calendar.appleCalendarDeniedHint')).toContain('disabled=""')
  })

  it('keeps the Apple chip disabled while a connect request is in flight', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips appleStatus="disconnected" appleBusy />)
    expect(buttonTagFor(html, 'calendar.appleCalendarConnectHint')).toContain('disabled=""')
  })

  it('shows the Apple disconnect hint and calls onDisconnect when connected', async () => {
    const onDisconnect = mock(() => {})
    const onConnect = mock(() => {})
    const { container, root } = await render(
      <CalendarConnectorChips appleStatus="connected" onConnect={onConnect} onDisconnect={onDisconnect} />,
    )
    mounted = root

    const button = appleButton(container)
    expect(button.getAttribute('aria-label')).toBe('calendar.appleCalendarConnectedHint')
    await act(async () => { button.click() })

    expect(onDisconnect).toHaveBeenCalledWith('appleCalendar')
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('calls onConnect with appleCalendar from the enabled Apple chip', async () => {
    const onConnect = mock(() => {})
    const { container, root } = await render(<CalendarConnectorChips appleStatus="disconnected" onConnect={onConnect} />)
    mounted = root

    const button = appleButton(container)
    expect(button.disabled).toBe(false)
    await act(async () => { button.click() })

    expect(onConnect).toHaveBeenCalledWith('appleCalendar')
  })
})