/**
 * e2.4 (part 2) — node-side capability advertisement.
 *
 * The model half (wave 5) lives in `packages/shared/src/device/capabilities.ts`:
 * `resolvedCaps`/`advertisedPermissions` map honest, host-reported permission
 * *statuses* onto the capabilities a node may advertise, dropping `unknown`
 * (unknown ≠ denied) and latching a denial so a later grant can never become a
 * false upgrade. The live TCC probes live in `./onboarding-permissions.ts`.
 *
 * This module is the coordinator that puts the two on a node connection:
 *
 *   probe a permission surface → resolve the advertisement → declare it on a
 *   `NodeClient` → heartbeat → route `nodes:invoke` to a handler map.
 *
 * Honesty rules carried through end to end:
 * - the advertisement is exactly the resolved, confirmed grant set — never a
 *   capability the probe did not confirm, never an `unknown` (not `false`);
 * - a denial is authoritative and is never advertised;
 * - the coordinator keeps the probe history, so a later reading that claims a
 *   grant for a previously denied capability cannot upgrade it;
 * - a later permission *change* is advisory only: `refreshAdvertisement()`
 *   re-resolves for display and NEVER silently re-declares/upgrades the node.
 *
 * It stays pure of `electron` except for the default permission surface, which
 * is the real `createOnboardingPermissionsHost()`; tests inject a surface.
 */

import {
  resolvedCaps,
  type CapabilityStatus,
  type ResolvedCapabilities,
} from '@rox/shared/device/capabilities'
import {
  NodeClient,
  type NodeClientOptions,
  type NodeInvokeHandler,
  type NodeInvokeRequest,
  type NodeView,
  type PresenceStatus,
} from '@rox/server-core/nodes'
import type { OnboardingPermissionsSnapshot } from '@rox/server-core/handlers/rpc/onboarding-permissions'
import { createOnboardingPermissionsHost } from './onboarding-permissions'

/**
 * The minimal permission seam this coordinator needs: something that can
 * produce a snapshot of host-reported permission statuses. The real
 * `OnboardingPermissionsHost` satisfies it; tests inject a fake.
 */
export interface NodeModePermissionSurface {
  probePermissions(): Promise<OnboardingPermissionsSnapshot>
}

/** Structural view of the node client the coordinator drives (NodeClient satisfies it). */
export interface NodeModeClient {
  readonly isRegistered: boolean
  start(): Promise<NodeView>
  heartbeat(): Promise<PresenceStatus>
  destroy(): void
}

export type NodeModeClientFactory = (options: NodeClientOptions) => NodeModeClient

export interface NodeModeOptions {
  /** Host WS URL, e.g. `ws://127.0.0.1:19012`. */
  readonly url: string
  /** Node id declared to the host. */
  readonly nodeId: string
  /** Commands this node genuinely serves, keyed by command name. */
  readonly handlers: Readonly<Record<string, NodeInvokeHandler>>
  /** Permission surface. Default: the real Electron TCC probes. */
  readonly permissions?: NodeModePermissionSurface
  /** Node client factory. Default: the real `NodeClient`. */
  readonly createClient?: NodeModeClientFactory
  readonly token?: string
  readonly workspaceId?: string
  readonly kind?: string
  readonly platform?: string
  readonly label?: string
  readonly heartbeatIntervalMs?: number
  readonly autoReconnect?: boolean
}

/** Stable error code for an invoke naming a command this node did not declare. */
export const NOT_DECLARED_CODE = 'NOT_DECLARED'

/** Error thrown when an invoke names a command the handler map does not back. */
export class NodeCommandNotDeclaredError extends Error {
  readonly code = NOT_DECLARED_CODE
  constructor(command: string) {
    super(`node did not declare command ${command}`)
    this.name = 'NodeCommandNotDeclaredError'
  }
}

/** Copy a probe snapshot's statuses into the model's plain status record. */
function toStatusRecord(snapshot: OnboardingPermissionsSnapshot): Record<string, CapabilityStatus> {
  const statuses: Record<string, CapabilityStatus> = {}
  for (const [key, value] of Object.entries(snapshot.statuses)) {
    if (value !== undefined) statuses[key] = value
  }
  return statuses
}

/**
 * Resolve one snapshot, or an ordered history of snapshots (oldest → newest),
 * into the definitive granted/denied capability sets. `unknown`/`unsupported`
 * readings are dropped; a denial latches against later grants.
 */
export function resolveNodeAdvertisement(
  snapshots: OnboardingPermissionsSnapshot | readonly OnboardingPermissionsSnapshot[],
): ResolvedCapabilities {
  const history = Array.isArray(snapshots) ? snapshots : [snapshots]
  return resolvedCaps(history.map(toStatusRecord))
}

/**
 * Build the host WS URL for a node connection, normalizing a wildcard bind
 * address to loopback (a client cannot connect to `0.0.0.0`/`::`).
 */
export function nodeModeUrl(bind: { protocol: string; host: string; port: number }): string {
  const host = bind.host === '0.0.0.0' || bind.host === '::' || bind.host === '' ? '127.0.0.1' : bind.host
  return `${bind.protocol}://${host}:${bind.port}`
}

/** Whether node mode is enabled. Default OFF; only the literal `1` turns it on. */
export function isNodeModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ROX_NODE_MODE === '1'
}

/**
 * Coordinates a node's advertisement over a real node connection.
 *
 * `start()` probes the permission surface once, resolves the confirmed grant
 * set, and declares exactly that set (plus the backed commands) on a
 * `NodeClient`, which also begins heartbeating. `onInvoke` routes each pushed
 * `nodes:invoke` to the handler map; an undeclared command is refused with a
 * typed `NOT_DECLARED` error.
 */
export class NodeModeCoordinator {
  private readonly options: NodeModeOptions
  private readonly permissions: NodeModePermissionSurface
  private readonly createClient: NodeModeClientFactory
  private readonly history: OnboardingPermissionsSnapshot[] = []
  private client: NodeModeClient | null = null
  private registeredAdvertisement: ResolvedCapabilities | null = null

  constructor(options: NodeModeOptions) {
    this.options = options
    this.permissions = options.permissions ?? createOnboardingPermissionsHost()
    this.createClient = options.createClient ?? ((clientOptions) => new NodeClient(clientOptions))
  }

  /** Probe, resolve, declare and connect. Idempotent guard: starts at most once. */
  async start(): Promise<NodeView> {
    if (this.client) throw new Error('NodeModeCoordinator: already started')

    await this.probe()
    const resolved = resolveNodeAdvertisement(this.history)
    const client = this.createClient({
      url: this.options.url,
      nodeId: this.options.nodeId,
      declaredCaps: [...resolved.granted],
      declaredCommands: Object.keys(this.options.handlers),
      onInvoke: (request) => this.route(request),
      ...(this.options.token !== undefined ? { token: this.options.token } : {}),
      ...(this.options.workspaceId !== undefined ? { workspaceId: this.options.workspaceId } : {}),
      ...(this.options.kind !== undefined ? { kind: this.options.kind } : {}),
      ...(this.options.platform !== undefined ? { platform: this.options.platform } : {}),
      ...(this.options.label !== undefined ? { label: this.options.label } : {}),
      ...(this.options.heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs: this.options.heartbeatIntervalMs } : {}),
      ...(this.options.autoReconnect !== undefined ? { autoReconnect: this.options.autoReconnect } : {}),
    })
    this.client = client
    const view = await client.start()
    this.registeredAdvertisement = resolved
    return view
  }

  /** The advertisement declared at registration. Null before `start()`. */
  get registered(): ResolvedCapabilities | null {
    return this.registeredAdvertisement
  }

  /** The caps actually declared at registration, in canonical order. */
  get advertisedCaps(): readonly string[] {
    return this.registeredAdvertisement?.granted ?? []
  }

  /**
   * Re-probe and re-resolve over the retained history. Advisory only: the node
   * is NOT re-registered and no denial can become a grant, so this can never be
   * a silent upgrade of what the host already knows.
   */
  async refreshAdvertisement(): Promise<ResolvedCapabilities> {
    await this.probe()
    return resolveNodeAdvertisement(this.history)
  }

  /** Refresh presence now (normal cadence is the client's own heartbeat). */
  async heartbeat(): Promise<PresenceStatus> {
    if (!this.client) throw new Error('NodeModeCoordinator: not started')
    return this.client.heartbeat()
  }

  /** Stop heartbeating and drop the connection. */
  destroy(): void {
    this.client?.destroy()
    this.client = null
  }

  private async probe(): Promise<OnboardingPermissionsSnapshot> {
    let snapshot: OnboardingPermissionsSnapshot
    try {
      snapshot = await this.permissions.probePermissions()
    } catch {
      // Honest failure: an unclassifiable surface grants nothing.
      snapshot = { platform: process.platform, statuses: {} }
    }
    this.history.push(snapshot)
    return snapshot
  }

  private async route(request: NodeInvokeRequest): Promise<unknown> {
    const handler = this.options.handlers[request.command]
    if (!handler) throw new NodeCommandNotDeclaredError(request.command)
    return handler(request)
  }
}