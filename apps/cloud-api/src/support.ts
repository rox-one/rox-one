/**
 * Support layer for Rox Cloud: three stores built once, two route tables.
 *
 * The stores come from `packages/cloud-support` and hold every support rule;
 * this file only decides *which* store instance the customer front and the
 * staff front share, so a ticket a customer opens is the ticket staff answer.
 *
 * The front door in `server.ts` needs to know which paths belong here, because
 * `app.ts` owns its own route table and does not know the support routes. That
 * knowledge lives next to the routes themselves, in `supportRouteKind`.
 */

import type { AbuseQueue, IncidentStore, TicketStore } from '../../../packages/cloud-support/src/index.ts'
import {
  createAbuseQueue,
  createIncidentStore,
  createTicketStore,
} from '../../../packages/cloud-support/src/index.ts'
import type { MemoryStore } from './store.ts'
import { createAdminRoutes, createCustomerRoutes } from './support-app.ts'
import type { SupportAudit, SupportRoutes } from './support-app.ts'

export type { SupportAudit, SupportAuditEntryInput, SupportRoutes } from './support-app.ts'

export interface SupportOptions {
  /** Control-plane state: the customer key is verified against it. */
  readonly store: MemoryStore
  /** Pre-built ticket store; omitted means a fresh one is created here. */
  readonly tickets?: TicketStore
  /** Pre-built incident store; omitted means a fresh one is created here. */
  readonly incidents?: IncidentStore
  /** Pre-built abuse queue; omitted means a fresh one is created here. */
  readonly abuse?: AbuseQueue
  /** Append-only staff trail; absent means staff writes leave no audit row. */
  readonly audit?: SupportAudit
  /** Shared staff key; absent means every staff route answers 404. */
  readonly adminKey?: string
  /** Clock for the stores and the key stamp; injected by tests. */
  readonly now?: () => number
}

export interface SupportApp {
  readonly tickets: TicketStore
  readonly incidents: IncidentStore
  readonly abuse: AbuseQueue
  /** `/v1/tickets…` and the public `/status` view. */
  readonly customerRoutes: SupportRoutes
  /** `/admin/tickets…`, `/admin/incidents…`, `/admin/abuse…`. */
  readonly adminRoutes: SupportRoutes
}

export type SupportRouteKind = 'customer' | 'staff'

/**
 * Which front owns which path prefix. The front door in `server.ts` asks this
 * because `app.ts` owns its own route table and does not know these paths.
 */
const ROUTE_PREFIXES: readonly { readonly kind: SupportRouteKind; readonly prefix: string }[] = [
  { kind: 'staff', prefix: '/v1/admin/tickets' },
  { kind: 'staff', prefix: '/v1/admin/incidents' },
  { kind: 'staff', prefix: '/v1/admin/abuse' },
  { kind: 'customer', prefix: '/v1/tickets' },
  { kind: 'customer', prefix: '/v1/status' },
]

/**
 * Which front owns this path, or `null` when the rest of the service does.
 *
 * `/v1/status` and `/v1/tickets` sit on the public origin, `/v1/admin/…` on the
 * staff one; `/status` is the site's page and `/admin/…` the panel's, so neither
 * is claimed here.
 */
export function supportRouteKind(pathname: string): SupportRouteKind | null {
  for (const entry of ROUTE_PREFIXES) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) return entry.kind
  }
  return null
}

export function createSupport(options: SupportOptions): SupportApp {
  const now = options.now ?? (() => Date.now())
  const clock = (): Date => new Date(now())
  // One instance each: the same queue every route reads and writes.
  const tickets = options.tickets ?? createTicketStore({ now: clock })
  const incidents = options.incidents ?? createIncidentStore({ now: clock })
  const abuse = options.abuse ?? createAbuseQueue({ now: clock })

  const customerRoutes = createCustomerRoutes({
    store: options.store,
    tickets,
    incidents,
    now,
  })
  const adminRoutes = createAdminRoutes({
    tickets,
    incidents,
    abuse,
    ...(options.audit === undefined ? {} : { audit: options.audit }),
    ...(options.adminKey === undefined ? {} : { adminKey: options.adminKey }),
  })

  return { tickets, incidents, abuse, customerRoutes, adminRoutes }
}
