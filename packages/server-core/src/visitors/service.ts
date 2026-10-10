/**
 * VisitorAccessService (port-matrix row a1.6).
 *
 * The single writer over a {@link VisitorGrantStore}. Every mutation runs
 * through one {@link SerialQueue}, so two concurrent `visitor_invite` /
 * `visitor_revoke` calls apply in call order and never interleave their
 * read-modify-write steps. Each mutation returns a typed result and appends one
 * ordered audit entry.
 *
 * The service also builds the `visitor-access` {@link AccessPolicyPlugin}: a
 * role that names that plugin admits a request only when the authenticated
 * principal subject maps onto a live grant, and refuses everything else.
 */
import type { AccessPolicyPlugin, AccessPolicyRequest } from '../authority/access-policy-registry.ts'
import { SerialQueue } from './serial-queue.ts'
import {
  visitorKey,
  visitorSubjectFromPrincipal,
  VisitorSubjectError,
  type VisitorAuditEntry,
  type VisitorGrant,
  type VisitorInviteResult,
  type VisitorRefusalCode,
  type VisitorRevokeResult,
  type VisitorSubject,
} from './types.ts'
import type { VisitorGrantStore, VisitorGrantOptions } from './grant-store.ts'
import { VisitorProviderNotConfiguredError, type VisitorProvider, type VisitorProviderIdentity } from './provider.ts'

/** Name a role must put in `accessPolicyPlugin` to be gated by this service. */
export const VISITOR_ACCESS_PLUGIN_NAME = 'visitor-access'

export interface VisitorAccessServiceOptions {
  store: VisitorGrantStore
  /** External identity verifier; absent means only local grants are possible. */
  provider?: VisitorProvider
  /** Injected clock for audit timestamps (tests). */
  now?: () => number
}

interface VisitorRefusal {
  ok: false
  code: VisitorRefusalCode
  message: string
}

function toRefusal(error: unknown): VisitorRefusal {
  if (error instanceof VisitorSubjectError || error instanceof VisitorProviderNotConfiguredError) {
    return { ok: false, code: error.code, message: error.message }
  }
  return { ok: false, code: 'VISITOR_STORE_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) }
}

export class VisitorAccessService {
  private readonly queue = new SerialQueue()
  private readonly store: VisitorGrantStore
  private readonly provider: VisitorProvider | null
  private readonly now: () => number
  /** Ordered mutation trail: entry order equals applied order. */
  readonly audit: VisitorAuditEntry[] = []
  private seq = 0

  constructor(options: VisitorAccessServiceOptions) {
    this.store = options.store
    this.provider = options.provider ?? null
    this.now = options.now ?? Date.now
  }

  /** Provider id when one is configured, else null. */
  get providerKind(): string | null {
    return this.provider?.provider ?? null
  }

  /** Synchronous admission check used by the plugin on every request. */
  admits(subject: VisitorSubject): boolean {
    try {
      return this.store.has(subject)
    } catch {
      return false
    }
  }

  /** Whether a raw principal subject currently holds a live grant. */
  admitsPrincipal(subject: string | null | undefined): boolean {
    const visitor = visitorSubjectFromPrincipal(subject)
    return visitor ? this.admits(visitor) : false
  }

  /** Grant (or replace) access. Serialized against every other mutation. */
  invite(subject: VisitorSubject, options: VisitorGrantOptions = {}): Promise<VisitorInviteResult> {
    return this.queue.enqueue((): VisitorInviteResult => {
      try {
        const replaced = this.store.has(subject)
        const grant = this.store.grant(subject, options)
        this.record('invite', grant.key)
        return { ok: true, grant, replaced }
      } catch (error) {
        return toRefusal(error)
      }
    })
  }

  /** Revoke a subject. Serialized against every other mutation. */
  revoke(subject: VisitorSubject): Promise<VisitorRevokeResult> {
    return this.queue.enqueue((): VisitorRevokeResult => {
      let key: string
      try {
        key = visitorKey(subject)
      } catch (error) {
        return toRefusal(error)
      }
      const grant = this.store.revoke(subject)
      this.record('revoke', key)
      return grant
        ? { ok: true, grant }
        : { ok: false, code: 'VISITOR_GRANT_NOT_FOUND', message: `No live visitor grant for ${key}` }
    })
  }

  /** Live grants (soonest-expiring first). */
  list(): VisitorGrant[] {
    return this.store.list()
  }

  /** Resolve a provider identity. Refuses typed when no provider is configured. */
  async resolveIdentity(subject: VisitorSubject): Promise<VisitorProviderIdentity> {
    if (!this.provider) {
      throw new VisitorProviderNotConfiguredError()
    }
    return this.provider.resolveIdentity(subject)
  }

  /** Await every mutation enqueued so far (shutdown / tests). */
  async drain(): Promise<void> {
    await this.queue.drain()
  }

  /**
   * The `visitor-access` plugin. `authorize` gates every request; `resume`
   * re-checks a reconnecting connection (a visitor whose grant lapsed while it
   * was connected is refused on resume).
   */
  buildPlugin(): AccessPolicyPlugin {
    const decide = (request: AccessPolicyRequest) => this.admitsPrincipal(request.subject)
    return { authorize: decide, resume: decide }
  }

  private record(op: VisitorAuditEntry['op'], key: string): void {
    this.seq += 1
    this.audit.push({ seq: this.seq, op, key, at: this.now() })
  }
}

