/**
 * f.9 — server-owned node/device registry.
 *
 * Clean-room re-expression of the OpenClaw NodeRegistry (port-analysis row f.9;
 * upstream `src/gateway/node-registry.ts:175`, `docs/gateway/protocol/handshake.md:276-318`).
 *
 * The central invariant ported here is **claims vs. allowlist**: a node declares
 * `caps`/`commands` on connect, but those are CLAIMS. The server holds its own
 * allowlist per node and refuses to dispatch any invoke whose command is not
 * both allowlisted and declared. A node that merely claims a capability the
 * server has not allowlisted is refused — the declaration can never widen its
 * own authority.
 *
 * Presence is tracked with a TTL; expiry fails the node's in-flight invokes.
 * Pending invokes are bounded per node and settle exactly once with a typed
 * terminal result (see `pending-invokes.ts`).
 *
 * Fencing: each invoke records the connection identity of the node at
 * dispatch. Re-registering a nodeId under a NEW connection identity is a
 * takeover — the previous connection's in-flight invokes settle
 * `error/SUPERSEDED` — and every later settlement must present the recorded
 * identity, so a superseded or impostor connection can never settle it.
 */

import {
  DEFAULT_PRESENCE_TTL_MS,
  PresenceTracker,
  type PresenceStatus,
} from './presence.ts'
import {
  DEFAULT_INVOKE_TIMEOUT_MS,
  DEFAULT_MAX_PENDING_PER_NODE,
  PendingInvokeTracker,
  type TerminalInvokeResult,
} from './pending-invokes.ts'

export interface NodeDeclaration {
  readonly nodeId: string
  /** Declared capabilities — a CLAIM, never authority. */
  readonly declaredCaps?: readonly string[]
  /** Declared commands — a CLAIM; dispatch also requires the server allowlist. */
  readonly declaredCommands?: readonly string[]
  readonly kind?: string
  readonly platform?: string
  readonly label?: string
  /** Opaque connection identity; a later registration with a new connId supersedes it. */
  readonly connId?: string
}

export interface NodeAllowlist {
  readonly caps?: readonly string[]
  readonly commands?: readonly string[]
}

export interface RegisteredNode {
  readonly nodeId: string
  readonly declaredCaps: readonly string[]
  readonly declaredCommands: readonly string[]
  readonly kind?: string
  readonly platform?: string
  readonly label?: string
  readonly connId?: string
  readonly registeredAt: number
}

export interface NodeView {
  readonly nodeId: string
  readonly declaredCaps: readonly string[]
  readonly declaredCommands: readonly string[]
  readonly kind?: string
  readonly platform?: string
  readonly label?: string
  readonly online: boolean
  readonly lastSeenAt: number | null
  /** Commands the server will actually dispatch: declared ∩ allowlisted ∩ online. */
  readonly authorizedCommands: readonly string[]
  readonly pendingInvokes: number
}

export type InvokeRefusalCode = 'NODE_UNKNOWN' | 'NODE_OFFLINE' | 'NOT_ALLOWLISTED' | 'NOT_DECLARED'

export interface InvokeRefusal {
  readonly code: InvokeRefusalCode
  readonly message: string
}

/**
 * Refusals raised when a settlement arrives from a connection that cannot
 * prove ownership of the invoke. `INVOKE_UNKNOWN` means nothing is in flight
 * under that id; `CONNECTION_MISMATCH` means it is in flight but belongs to a
 * different connection — the impostor's settlement is dropped, never applied.
 */
export type InvokeOwnershipRefusalCode = 'INVOKE_UNKNOWN' | 'CONNECTION_MISMATCH'

export interface InvokeOwnershipRefusal {
  readonly code: InvokeOwnershipRefusalCode
  readonly message: string
}

export type InvokeSettlement =
  | { readonly settled: true }
  | { readonly settled: false; readonly refusal: InvokeOwnershipRefusal }

export interface NodeInvokeDispatch {
  /** True when a pending invoke was created and should be sent to the node. */
  readonly accepted: boolean
  /** Present only when accepted. */
  readonly invokeId: string | null
  /**
   * Connection identity of the node at dispatch time; null when the node was
   * registered without one. The push must target this connection.
   */
  readonly connId: string | null
  /** Terminal result: already resolved on refusal, resolved later when accepted. */
  readonly result: Promise<TerminalInvokeResult>
}

export interface NodeRegistryOptions {
  /** Presence TTL. Default 30s. */
  readonly presenceTtlMs?: number
  /** Concurrent in-flight invokes per node. Default 16. */
  readonly maxPendingPerNode?: number
  /** Default invoke deadline. Default 30s. */
  readonly invokeTimeoutMs?: number
  /** Injected clock. Default `Date.now`. */
  readonly now?: () => number
  /** Injected timer (default `setTimeout`); tests pass a no-op and drive `sweep`. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  /** Injected timer cancel (default `clearTimeout`). */
  readonly clearTimer?: (handle: unknown) => void
}

export interface PresenceSweepResult {
  /** Node ids whose presence TTL elapsed this sweep. */
  readonly expired: readonly string[]
  /** In-flight invokes failed because their node went offline. */
  readonly failedInvokes: number
}

type AuthorizeDecision =
  | { readonly ok: true; readonly node: RegisteredNode }
  | { readonly ok: false; readonly refusal: InvokeRefusal }

export class NodeRegistry {
  private readonly nodes = new Map<string, RegisteredNode>()
  private readonly allowlists = new Map<string, NodeAllowlist>()
  private defaultAllowlist: NodeAllowlist = {}
  private readonly presence: PresenceTracker
  private readonly pending: PendingInvokeTracker
  private readonly clock: () => number

  constructor(options: NodeRegistryOptions = {}) {
    this.clock = options.now ?? Date.now
    this.presence = new PresenceTracker({ ttlMs: options.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS, now: this.clock })
    this.pending = new PendingInvokeTracker({
      maxPerNode: options.maxPendingPerNode ?? DEFAULT_MAX_PENDING_PER_NODE,
      timeoutMs: options.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS,
      now: this.clock,
      ...(options.setTimer ? { setTimer: options.setTimer } : {}),
      ...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
    })
  }

  // --- declarations (claims) ------------------------------------------------

  /**
   * Register or reconnect a node. The declaration is stored as claims only;
   * authority comes from the server allowlist. Presence is refreshed on
   * (re)connect so re-registration revives a node whose TTL had elapsed.
   *
   * Fencing: when the node is already known under a DIFFERENT connection
   * identity, the previous connection is superseded — its in-flight invokes
   * settle `error/SUPERSEDED` immediately, so a late answer from the stale
   * connection can never win against the new one. Re-registering without a
   * `connId` (or with the same one) is a heartbeat, not a takeover.
   */
  registerNode(declaration: NodeDeclaration): RegisteredNode {
    if (typeof declaration.nodeId !== 'string' || declaration.nodeId.length === 0) {
      throw new Error('NodeRegistry: nodeId is required')
    }
    const node: RegisteredNode = {
      nodeId: declaration.nodeId,
      declaredCaps: [...(declaration.declaredCaps ?? [])],
      declaredCommands: [...(declaration.declaredCommands ?? [])],
      ...(declaration.kind !== undefined ? { kind: declaration.kind } : {}),
      ...(declaration.platform !== undefined ? { platform: declaration.platform } : {}),
      ...(declaration.label !== undefined ? { label: declaration.label } : {}),
      ...(declaration.connId !== undefined ? { connId: declaration.connId } : {}),
      registeredAt: this.clock(),
    }
    const previous = this.nodes.get(node.nodeId)
    if (node.connId !== undefined && previous?.connId !== node.connId) {
      this.pending.failForNode(node.nodeId, {
        code: 'SUPERSEDED',
        message: `node ${node.nodeId} was superseded by a new connection`,
      })
    }
    this.nodes.set(node.nodeId, node)
    this.presence.touch(node.nodeId)
    return node
  }

  /** Whether `connId` is the connection that currently owns `nodeId`. */
  ownsNode(nodeId: string, connId: string | undefined): boolean {
    const node = this.nodes.get(nodeId)
    if (!node) return false
    // A node registered without a connection identity (embedded host) is unfenced.
    return node.connId === undefined || node.connId === connId
  }

  /**
   * Forget a node entirely: fails its in-flight invokes and drops presence.
   * Returns false when the node was never registered.
   */
  unregisterNode(nodeId: string): boolean {
    const existed = this.nodes.delete(nodeId)
    this.presence.forget(nodeId)
    this.pending.failForNode(nodeId, { code: 'DISCONNECTED', message: `node ${nodeId} disconnected` })
    return existed
  }

  getNode(nodeId: string): RegisteredNode | null {
    return this.nodes.get(nodeId) ?? null
  }

  listNodes(at: number = this.clock()): NodeView[] {
    return [...this.nodes.values()]
      .map((node) => this.toView(node, at))
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
  }

  // --- server-owned allowlist -----------------------------------------------

  /** Set the server allowlist for one node. Absent entries fall back to the default. */
  setAllowlist(nodeId: string, allowlist: NodeAllowlist): void {
    this.allowlists.set(nodeId, allowlist)
  }

  /** Clear the node-specific allowlist, restoring the default fallback. */
  clearAllowlist(nodeId: string): boolean {
    return this.allowlists.delete(nodeId)
  }

  setDefaultAllowlist(allowlist: NodeAllowlist): void {
    this.defaultAllowlist = allowlist
  }

  getAllowlist(nodeId: string): NodeAllowlist {
    return this.allowlists.get(nodeId) ?? this.defaultAllowlist
  }

  /** Whether the server would dispatch `command` to `nodeId` right now. */
  isCommandAuthorized(nodeId: string, command: string): boolean {
    return this.authorize(nodeId, command).ok
  }

  // --- presence -------------------------------------------------------------

  /** Refresh presence (registration, heartbeat). */
  touch(nodeId: string, at: number = this.clock()): PresenceStatus {
    return this.presence.touch(nodeId, at)
  }

  presenceStatus(nodeId: string, at: number = this.clock()): PresenceStatus | null {
    return this.presence.status(nodeId, at)
  }

  /** Sweep presence TTLs and fail the invokes of any node that went offline. */
  sweep(at: number = this.clock()): PresenceSweepResult {
    const expired = this.presence.sweep(at)
    let failedInvokes = 0
    for (const nodeId of expired) {
      failedInvokes += this.pending.failForNode(nodeId, { code: 'DISCONNECTED', message: `node ${nodeId} presence expired` })
    }
    return { expired, failedInvokes }
  }

  // --- pending invokes ------------------------------------------------------

  /**
   * Dispatch a command to a node. Enforces the server allowlist BEFORE any
   * pending invoke is created: a refused dispatch has no side effects and
   * resolves immediately with a typed terminal error.
   */
  invoke(nodeId: string, command: string, opts: { timeoutMs?: number } = {}): NodeInvokeDispatch {
    const decision = this.authorize(nodeId, command)
    if (!decision.ok) {
      return {
        accepted: false,
        invokeId: null,
        connId: null,
        result: Promise.resolve({
          status: 'error',
          invokeId: '',
          nodeId,
          command,
          error: { code: decision.refusal.code, message: decision.refusal.message },
        }),
      }
    }

    // Bind the invoke to the node's current connection: every later settlement
    // must present that identity, so a superseded/impostor connection cannot
    // settle it (it would already have been failed with SUPERSEDED anyway).
    const connId = decision.node.connId
    const created = this.pending.create(nodeId, command, connId === undefined ? opts : { ...opts, connId })
    if (!created.ok) {
      return {
        accepted: false,
        invokeId: null,
        connId: connId ?? null,
        result: Promise.resolve({ status: 'error', invokeId: '', nodeId, command, error: created.error }),
      }
    }
    return { accepted: true, invokeId: created.handle.invokeId, connId: connId ?? null, result: created.handle.result }
  }

  /** Settle an invoke as `ok`; false when unknown or already settled. */
  settleInvoke(invokeId: string, payload: unknown): boolean {
    return this.pending.resolve(invokeId, payload)
  }

  /** Settle an invoke as `error`; false when unknown or already settled. */
  failInvoke(invokeId: string, error: { code: string; message: string }): boolean {
    return this.pending.fail(invokeId, error)
  }

  /**
   * Settle an invoke as `ok` on behalf of `connId`. A connection that does not
   * own the invoke is refused typed and the invoke is NOT settled.
   */
  settleInvokeFrom(invokeId: string, payload: unknown, connId: string | undefined): InvokeSettlement {
    const refusal = this.ownershipRefusal(invokeId, connId)
    if (refusal) return { settled: false, refusal }
    if (this.pending.resolve(invokeId, payload)) return { settled: true }
    return { settled: false, refusal: { code: 'INVOKE_UNKNOWN', message: `invoke ${invokeId} is not pending` } }
  }

  /** Settle an invoke as `error` on behalf of `connId`; see `settleInvokeFrom`. */
  failInvokeFrom(invokeId: string, error: { code: string; message: string }, connId: string | undefined): InvokeSettlement {
    const refusal = this.ownershipRefusal(invokeId, connId)
    if (refusal) return { settled: false, refusal }
    if (this.pending.fail(invokeId, error)) return { settled: true }
    return { settled: false, refusal: { code: 'INVOKE_UNKNOWN', message: `invoke ${invokeId} is not pending` } }
  }

  /**
   * Ownership fence for a settlement attempt. Returns null when the presented
   * connection may settle the invoke: an unspecified `connId` is the in-process
   * (privileged) caller, and an unfenced invoke has no owner to enforce. A
   * present-but-different identity is refused and never falls through to settle.
   */
  private ownershipRefusal(invokeId: string, connId: string | undefined): InvokeOwnershipRefusal | null {
    const owner = this.pending.ownerOf(invokeId)
    if (!owner.known) return { code: 'INVOKE_UNKNOWN', message: `invoke ${invokeId} is not pending` }
    if (connId === undefined || owner.connId === undefined || owner.connId === connId) return null
    return {
      code: 'CONNECTION_MISMATCH',
      message: `invoke ${invokeId} belongs to connection ${owner.connId}, not ${connId}`,
    }
  }

  /** Cancel an invoke deterministically; settles `error/CANCELLED` exactly once. */
  cancelInvoke(invokeId: string): boolean {
    return this.pending.cancel(invokeId)
  }

  /** Settle every invoke whose deadline passed. Returns settled ids. */
  sweepInvokeTimeouts(at: number = this.clock()): string[] {
    return this.pending.sweep(at)
  }

  pendingCountFor(nodeId: string): number {
    return this.pending.pendingCountFor(nodeId)
  }

  // --- internals ------------------------------------------------------------

  private authorize(nodeId: string, command: string): AuthorizeDecision {
    const node = this.nodes.get(nodeId)
    if (!node) {
      return { ok: false, refusal: { code: 'NODE_UNKNOWN', message: `unknown node ${nodeId}` } }
    }
    if (!this.presence.isOnline(nodeId)) {
      return { ok: false, refusal: { code: 'NODE_OFFLINE', message: `node ${nodeId} is offline` } }
    }
    const allowlist = this.getAllowlist(nodeId)
    if (!(allowlist.commands ?? []).includes(command)) {
      return { ok: false, refusal: { code: 'NOT_ALLOWLISTED', message: `command ${command} is not allowlisted for node ${nodeId}` } }
    }
    if (!node.declaredCommands.includes(command)) {
      return { ok: false, refusal: { code: 'NOT_DECLARED', message: `node ${nodeId} did not declare command ${command}` } }
    }
    return { ok: true, node }
  }

  private toView(node: RegisteredNode, at: number): NodeView {
    const status = this.presence.status(node.nodeId, at)
    const online = status?.online ?? false
    const allowlist = this.getAllowlist(node.nodeId)
    const authorizedCommands = online
      ? node.declaredCommands.filter((command) => (allowlist.commands ?? []).includes(command))
      : []
    return {
      nodeId: node.nodeId,
      declaredCaps: node.declaredCaps,
      declaredCommands: node.declaredCommands,
      ...(node.kind !== undefined ? { kind: node.kind } : {}),
      ...(node.platform !== undefined ? { platform: node.platform } : {}),
      ...(node.label !== undefined ? { label: node.label } : {}),
      online,
      lastSeenAt: status?.lastSeenAt ?? null,
      authorizedCommands,
      pendingInvokes: this.pending.pendingCountFor(node.nodeId),
    }
  }
}