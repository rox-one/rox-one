import { expect, test } from 'bun:test'
import { CodedError } from '@rox/shared/protocol'
import { MAX_WIDGET_TICKET_TTL_MS, WidgetTicketRegistry } from '../widget-tickets.ts'

function codeOf(run: () => unknown): string {
  try { run() } catch (error) { if (error instanceof CodedError) return error.code; throw error }
  throw new Error('expected the call to throw a CodedError')
}

test('mount → validate round-trips against the mounted revision', () => {
  const registry = new WidgetTicketRegistry()
  const ticket = registry.mount({ widgetId: 'chart', revision: 1 })
  expect(ticket).toMatchObject({ widgetId: 'chart', revision: 1, viewGeneration: 0 })
  expect(ticket.expiresAt - ticket.issuedAt).toBeLessThanOrEqual(MAX_WIDGET_TICKET_TTL_MS)
  expect(registry.validate({ nonce: ticket.nonce, widgetId: 'chart', revision: 1 })).toMatchObject({ ticketId: ticket.ticketId })
})

test('a stale ticket after a re-put is refused even with the new revision', () => {
  const registry = new WidgetTicketRegistry()
  const ticket = registry.mount({ widgetId: 'chart', revision: 1 })
  registry.rotate('chart')
  expect(codeOf(() => registry.validate({ nonce: ticket.nonce, widgetId: 'chart', revision: 2 }))).toBe('WIDGET_TICKET_REFUSED')
  expect(registry.generationOf('chart')).toBe(1)
})

test('a ticket minted in one registry is refused by another (cross-workspace)', () => {
  const a = new WidgetTicketRegistry()
  const b = new WidgetTicketRegistry()
  const ticket = a.mount({ widgetId: 'chart', revision: 1 })
  expect(codeOf(() => b.validate({ nonce: ticket.nonce, widgetId: 'chart', revision: 1 }))).toBe('WIDGET_TICKET_REFUSED')
})

test('malformed, unknown and mismatched tickets all share one typed refusal', () => {
  const registry = new WidgetTicketRegistry()
  const ticket = registry.mount({ widgetId: 'chart', revision: 1 })
  expect(codeOf(() => registry.validate({ nonce: '', widgetId: 'chart', revision: 1 }))).toBe('WIDGET_TICKET_REFUSED')
  expect(codeOf(() => registry.validate({ nonce: 'deadbeef', widgetId: 'chart', revision: 1 }))).toBe('WIDGET_TICKET_REFUSED')
  expect(codeOf(() => registry.validate({ nonce: ticket.nonce, widgetId: 'other', revision: 1 }))).toBe('WIDGET_TICKET_REFUSED')
  expect(codeOf(() => registry.validate({ nonce: ticket.nonce, widgetId: 'chart', revision: 9 }))).toBe('WIDGET_TICKET_REFUSED')
  // Unchecked cast: the wire can carry a missing revision; the registry is the runtime boundary.
  expect(codeOf(() => registry.validate({ nonce: ticket.nonce } as unknown as Parameters<typeof registry.validate>[0]))).toBe('WIDGET_TICKET_REFUSED')
})

test('an expired ticket is refused and pruned', () => {
  let now = 1_000
  const registry = new WidgetTicketRegistry({ leaseTtlMs: 50, now: () => now })
  const ticket = registry.mount({ widgetId: 'chart', revision: 1 })
  now += 51
  expect(codeOf(() => registry.validate({ nonce: ticket.nonce, widgetId: 'chart', revision: 1 }))).toBe('WIDGET_TICKET_REFUSED')
  expect(registry.size).toBe(0)
})

test('the TTL is capped at 20 minutes regardless of configuration', () => {
  const registry = new WidgetTicketRegistry({ leaseTtlMs: MAX_WIDGET_TICKET_TTL_MS * 10 })
  const ticket = registry.mount({ widgetId: 'chart', revision: 1 })
  expect(ticket.expiresAt - ticket.issuedAt).toBe(MAX_WIDGET_TICKET_TTL_MS)
})

test('the store stays bounded and evicts the oldest ticket first', () => {
  let now = 1_000
  const registry = new WidgetTicketRegistry({ maxTickets: 4, now: () => now })
  const tickets = Array.from({ length: 6 }, (_, index) => {
    now += 1
    return registry.mount({ widgetId: `w-${index}`, revision: 1 })
  })
  expect(registry.size).toBe(4)
  // The two oldest are gone; the newest four validate.
  expect(codeOf(() => registry.validate({ nonce: tickets[0]!.nonce, widgetId: 'w-0', revision: 1 }))).toBe('WIDGET_TICKET_REFUSED')
  expect(registry.validate({ nonce: tickets[5]!.nonce, widgetId: 'w-5', revision: 1 })).toBeDefined()
})

test('release is idempotent and accepts the nonce (release) or the ticketId', () => {
  const registry = new WidgetTicketRegistry()
  const byNonce = registry.mount({ widgetId: 'chart', revision: 1 })
  const byId = registry.mount({ widgetId: 'chart', revision: 1 })
  expect(registry.release(byNonce.nonce)).toBe(true)
  expect(registry.release(byNonce.nonce)).toBe(false)
  expect(registry.release(byId.ticketId)).toBe(true)
  expect(registry.size).toBe(0)
})