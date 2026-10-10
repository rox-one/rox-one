import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@rox/ui'
import { CALENDAR_PROVIDERS, CalendarConnectorChips } from '../CalendarConnectorChips'

useDomForFile()

// A local i18n instance with identity fallback beats `mock.module('react-i18next')`:
// Bun module mocks are process-wide and installed at import time, so a global mock
// here silently re-writes every other suite that loads `react-i18next` in the same
// run (a real regression we hit). Keys the assertions name verbatim stay identity
// keys; only the interpolated hints need concrete templates.
let i18n: I18n
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    parseMissingKeyHandler: (key: string) => key,
    resources: {
      en: {
        translation: {
          ...Object.fromEntries(CALENDAR_PROVIDERS.map(provider => [`calendar.provider.${provider}`, provider])),
          'calendar.googleUnavailableHint': 'calendar.googleUnavailableHint:{{provider}}',
          'calendar.appleCalendarUnavailableHint': 'calendar.appleCalendarUnavailableHint:{{provider}}',
          'calendar.connectionUnavailable': 'calendar.connectionUnavailable:{{provider}}',
        },
      },
    },
  })
})

function wrap(node: ReactNode): ReactNode {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>
  )
}

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
  await act(async () => { root.render(wrap(node)) })
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
    const html = renderToStaticMarkup(wrap(<CalendarConnectorChips />))

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length)
    expect(html).toContain('calendar.googleUnavailableHint:google')
    expect(html).toContain('calendar.appleCalendarUnavailableHint:appleCalendar')
    for (const provider of CALENDAR_PROVIDERS.filter((item) => item !== 'google' && item !== 'appleCalendar')) {
      expect(html).toContain(`calendar.connectionUnavailable:${provider}`)
    }
  })

  it('enables the Google chip with a connect hint when the connector is disconnected', () => {
    const html = renderToStaticMarkup(wrap(<CalendarConnectorChips googleStatus="disconnected" />))

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length - 1)
    expect(html).toContain('calendar.googleConnectHint')
    expect(html).not.toContain('calendar.googleUnavailableHint')
  })

  it('enables the Google chip with a disconnect hint when the connector is connected', () => {
    const html = renderToStaticMarkup(wrap(<CalendarConnectorChips googleStatus="connected" />))

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length - 1)
    expect(html).toContain('calendar.googleConnectedHint')
  })

  it('disables the Google chip while a connect request is in flight', () => {
    const html = renderToStaticMarkup(wrap(<CalendarConnectorChips googleStatus="disconnected" googleBusy />))

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length)
  })

  it('shows the Apple unavailable hint without a live helper and keeps the chip disabled', () => {
    const html = renderToStaticMarkup(wrap(<CalendarConnectorChips appleStatus="unavailable" />))
    expect(buttonTagFor(html, 'calendar.appleCalendarUnavailableHint:appleCalendar')).toContain('disabled=""')
  })

  it('keeps the Apple chip disabled with a denial hint when macOS access was denied', () => {
    const html = renderToStaticMarkup(wrap(<CalendarConnectorChips appleStatus="denied" />))
    expect(buttonTagFor(html, 'calendar.appleCalendarDeniedHint')).toContain('disabled=""')
  })

  it('keeps the Apple chip disabled while a connect request is in flight', () => {
    const html = renderToStaticMarkup(wrap(<CalendarConnectorChips appleStatus="disconnected" appleBusy />))
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