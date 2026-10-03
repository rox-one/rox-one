/**
 * Transport-layer interfaces for the WS-based RPC.
 */

import type { PushTarget } from '@rox/shared/protocol'
import type { NativeAuthorityAction, NativePrincipal } from '../authority/native-authority'
import type { AuthenticatedActor } from '../../../shared/src/workspace-domain/identity/contracts'

/** Opaque resolver result retained server-side; never decoded from an envelope. */
export interface WorkspaceAuthoritySession {
  readonly actor: AuthenticatedActor
  readonly identity: Readonly<{
    issuer: string
    subject: string
    principalId: string
    sessionId: string
    deviceId: string
    expiresAt: number
  }>
}

/** The composition root injects the real cryptographic/persisted-session resolver. */
export interface WorkspaceAuthorityAuthentication {
  authenticate(token: string): Promise<WorkspaceAuthoritySession>
  revalidate(bound: WorkspaceAuthoritySession): Promise<WorkspaceAuthoritySession>
}

export interface RequestContext {
  clientId: string
  workspaceId: string | null
  webContentsId: number | null
  /** Server-minted capability, never taken from request arguments. */
  principal?: NativePrincipal
  /** Current verified server-only Actor; absent for standalone/local clients. */
  readonly actor?: AuthenticatedActor
}

export type HandlerFn = (ctx: RequestContext, ...args: any[]) => Promise<any> | any

/**
 * An opt-in access restriction for a handler. Existing handlers remain
 * transport-compatible unless they explicitly choose a restriction.
 */
export interface RpcHandlerOptions {
  readonly access?: 'localElectron' | 'nativeOrLocalElectron' | 'authenticatedWorkspace'
  /** Native clients are denied unless a handler explicitly declares its grant. */
  readonly nativeAction?: Exclude<NativeAuthorityAction, 'manage'>
  /** Host-selected bounded timeout for long audio operations; never accepted from request args. */
  readonly timeoutMs?: number
  /** Host-only asynchronous check. Shared identity is revalidated again after it settles, before serialization. */
  readonly beforeResponse?: (context: RequestContext, arguments_: readonly unknown[], result: unknown) => Promise<void>
  /**
   * Final shared-authority admission, available only with authenticatedWorkspace
   * access. The trusted host must check the current persisted session, membership
   * and Resource read permission in the same authority operation (for example,
   * one transaction holding the corresponding read locks). The supplied Actor
   * is server-bound; it is not itself proof that those live checks succeeded.
   * Runs after beforeResponse and fresh identity admission. No asynchronous
   * transport operation follows this guard before serialization and send.
   */
  readonly beforeWorkspaceResponse?: (context: RequestContext, arguments_: readonly unknown[], result: unknown) => Promise<void>
}

export interface RpcServer {
  /** Host-owned background tasks are disposed with the transport. */
  onShutdown?(dispose: () => void): () => void
  /** Dispose request-owned resources as soon as their socket disconnects. */
  onClientDisconnect?(listener: (clientId: string) => void): () => void
  /** True only while the original socket, workspace and grant generation remain current. */
  isRequestContextCurrent?(context: RequestContext, nativeAction?: Exclude<NativeAuthorityAction, 'manage'>): boolean
  handle(channel: string, handler: HandlerFn, options?: RpcHandlerOptions): void
  push(channel: string, target: PushTarget, ...args: any[]): void
  invokeClient(clientId: string, channel: string, ...args: any[]): Promise<any>
  updateClientWorkspace?(clientId: string, workspaceId: string): void

  /** Whether a connected client advertised the given capability on handshake. */
  hasClientCapability(clientId: string, capability: string): boolean

  /** Connected clients (optionally narrowed by workspaceId) that advertised the capability. */
  findClientsWithCapability(capability: string, opts?: { workspaceId?: string }): string[]
}

export interface RpcClient {
  invoke(channel: string, ...args: any[]): Promise<any>
  on(channel: string, callback: (...args: any[]) => void): () => void
  handleCapability(channel: string, handler: (...args: any[]) => Promise<any> | any): void
}

export type EventSink = (channel: string, target: PushTarget, ...args: any[]) => void
