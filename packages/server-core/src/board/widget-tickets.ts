/**
 * Board widget render tickets (wave 3, row b2.3).
 *
 * A ticket is the capability a mounting host hands to a widget frame. It binds
 * one mount to an EXACT (widgetId, revision) and to the current view generation
 * of that widget, so:
 *
 *   - a re-put (new revision) advances the generation and drops the widget's
 *     live tickets — an old frame's nonce can no longer be replayed against the
 *     new revision, even if the caller supplies the new revision number;
 *   - a ticket minted in one workspace's registry is never accepted by another
 *     workspace's registry (the nonce is unknown there), so a ticket cannot be
 *     crossed between boards;
 *   - every rejection is one uniform typed refusal (`WIDGET_TICKET_REFUSED`)
 *     with a constant message: the sandbox never learns whether a nonce was
 *     unknown, expired, stale or forged.
 *
 * The registry is bounded: expired tickets are pruned on every mount, and when
 * the live count reaches the cap the oldest ticket is evicted first. The
 * lifetime is capped at 20 minutes regardless of the configured TTL.
 *
 * Mirrors the pages render-lease broker (`PageActionBroker`) rather than
 * re-implementing its shape — same nonce-over-the-wire capability model, no
 * audit log because a widget ticket carries no action authority.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { CodedError } from '@rox/shared/protocol'

/** Hard ceiling on a ticket's lifetime: 20 minutes. */
export const MAX_WIDGET_TICKET_TTL_MS = 20 * 60_000
const DEFAULT_MAX_TICKETS = 128

export interface WidgetTicket {
  ticketId: string
  /** Capability string handed to the widget frame and echoed on validate/release. */
  nonce: string
  widgetId: string
  revision: number
  /** Widget view generation at mint time; a re-put advances it. */
  viewGeneration: number
  issuedAt: number
  expiresAt: number
}

export interface WidgetTicketMountInput {
  widgetId: string
  revision: number
}

export interface WidgetTicketValidateInput {
  nonce: string
  widgetId: string
  revision: number
}

export interface WidgetTicketRegistryOptions {
  /** Ticket lifetime in ms; clamped to MAX_WIDGET_TICKET_TTL_MS. */
  leaseTtlMs?: number
  maxTickets?: number
  now?: () => number
}

/** The one refusal every rejected ticket raises: no reason is ever disclosed. */
function refuse(): never {
  throw new CodedError('WIDGET_TICKET_REFUSED', 'Widget ticket refused')
}

export class WidgetTicketRegistry {
  private readonly leaseTtlMs: number
  private readonly maxTickets: number
  private readonly now: () => number
  private readonly tickets = new Map<string, WidgetTicket>()
  private readonly nonceIndex = new Map<string, string>()
  private readonly generations = new Map<string, number>()

  constructor(options: WidgetTicketRegistryOptions = {}) {
    this.leaseTtlMs = Math.min(options.leaseTtlMs ?? MAX_WIDGET_TICKET_TTL_MS, MAX_WIDGET_TICKET_TTL_MS)
    if (!(this.leaseTtlMs > 0)) throw new Error('Widget ticket TTL must be positive')
    this.maxTickets = options.maxTickets ?? DEFAULT_MAX_TICKETS
    if (!Number.isInteger(this.maxTickets) || this.maxTickets < 1) throw new Error('Widget ticket cap must be a positive integer')
    this.now = options.now ?? Date.now
  }

  /** Live ticket count after pruning expired entries. */
  get size(): number {
    this.pruneExpired()
    return this.tickets.size
  }

  /** Current view generation for a widget (0 before its first re-put). */
  generationOf(widgetId: string): number {
    return this.generations.get(widgetId) ?? 0
  }

  /** Mint a ticket for one mount of the widget's current revision. */
  mount(input: WidgetTicketMountInput): WidgetTicket {
    this.pruneExpired()
    if (this.tickets.size >= this.maxTickets) {
      let oldest: WidgetTicket | undefined
      for (const ticket of this.tickets.values()) {
        if (!oldest || ticket.issuedAt < oldest.issuedAt) oldest = ticket
      }
      if (oldest) this.drop(oldest.ticketId)
    }
    const issuedAt = this.now()
    const ticket: WidgetTicket = {
      ticketId: randomUUID(),
      nonce: randomBytes(16).toString('hex'),
      widgetId: input.widgetId,
      revision: input.revision,
      viewGeneration: this.generationOf(input.widgetId),
      issuedAt,
      expiresAt: issuedAt + this.leaseTtlMs,
    }
    this.tickets.set(ticket.ticketId, ticket)
    this.nonceIndex.set(ticket.nonce, ticket.ticketId)
    return { ...ticket }
  }

  /**
   * Advance a widget's view generation and drop its live tickets. Called after
   * every accepted re-put so previous mounts can never observe a later revision.
   */
  rotate(widgetId: string): number {
    const generation = this.generationOf(widgetId) + 1
    this.generations.set(widgetId, generation)
    for (const ticket of [...this.tickets.values()]) {
      if (ticket.widgetId === widgetId) this.drop(ticket.ticketId)
    }
    return generation
  }

  /**
   * Validate a nonce against (widgetId, revision) and the current generation.
   * Every rejection is the same typed refusal.
   */
  validate(input: WidgetTicketValidateInput): WidgetTicket {
    const ticketId = typeof input?.nonce === 'string' && input.nonce.length > 0 ? this.nonceIndex.get(input.nonce) : undefined
    const ticket = ticketId === undefined ? undefined : this.tickets.get(ticketId)
    if (ticket === undefined || ticket.widgetId !== input.widgetId || ticket.revision !== input.revision) refuse()
    if (this.now() >= ticket.expiresAt || ticket.viewGeneration !== this.generationOf(ticket.widgetId)) {
      this.drop(ticket.ticketId)
      refuse()
    }
    return { ...ticket }
  }

  /** Release by nonce or ticketId. Idempotent; reports whether a ticket existed. */
  release(token: string): boolean {
    const ticketId = this.nonceIndex.get(token) ?? token
    if (!this.tickets.has(ticketId)) return false
    this.drop(ticketId)
    return true
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const ticket of [...this.tickets.values()]) {
      if (now >= ticket.expiresAt) this.drop(ticket.ticketId)
    }
  }

  private drop(ticketId: string): void {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) return
    this.tickets.delete(ticketId)
    if (this.nonceIndex.get(ticket.nonce) === ticketId) this.nonceIndex.delete(ticket.nonce)
  }
}

/**
 * One registry per workspace, shared by every writer in this process (the board
 * RPC handlers AND the `show_widget` tool callbacks) so a re-put through either
 * path rotates the same view generation.
 *
 * `options` apply only when the registry for `workspaceRootPath` is created —
 * the first caller wins, every later caller shares it. Production callers pass
 * none (the defaults); a host or test harness may pre-create the registry with
 * a shorter TTL.
 */
const registries = new Map<string, WidgetTicketRegistry>()

export function widgetTicketRegistryFor(workspaceRootPath: string, options?: WidgetTicketRegistryOptions): WidgetTicketRegistry {
  let registry = registries.get(workspaceRootPath)
  if (!registry) {
    registry = new WidgetTicketRegistry(options)
    registries.set(workspaceRootPath, registry)
  }
  return registry
}