import { describe, expect, it, mock } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

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

describe('calendar connector controls', () => {
  it('keeps every provider disabled with an honest hint when Google is not configured', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips />)

    expect(disabledCount(html)).toBe(CALENDAR_PROVIDERS.length)
    expect(html).toContain('calendar.googleUnavailableHint:google')
    for (const provider of CALENDAR_PROVIDERS.filter((item) => item !== 'google')) {
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
})