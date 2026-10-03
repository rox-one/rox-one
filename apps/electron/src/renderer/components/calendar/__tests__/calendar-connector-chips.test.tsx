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

describe('calendar connector controls', () => {
  it('renders disabled provider actions with an explanation when connection setup is unavailable', () => {
    const html = renderToStaticMarkup(<CalendarConnectorChips />)
    const disabledButtons = html.match(/<button[^>]*disabled=""/g) ?? []

    expect(disabledButtons).toHaveLength(CALENDAR_PROVIDERS.length)
    for (const provider of CALENDAR_PROVIDERS) {
      expect(html).toContain(`calendar.connectionUnavailable:${provider}`)
    }
  })
})
