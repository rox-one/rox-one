import { WsRpcClient } from './client'
import { peerTrustOptionsForRemote } from '../shared/remote-tls-client-options'
import {
  DOMAIN_PROJECT_RPC,
} from '../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import {
  ProjectAuthorityError,
  requireProjectAuthorityConfiguration,
  type ProjectAuthorityState,
  type ProjectAuthorityTarget,
} from '../shared/project-authority'

const channels: ReadonlySet<string> = new Set(Object.values(DOMAIN_PROJECT_RPC))
export function isProjectAuthorityChannel(channel: string): boolean { return channels.has(channel) }
export type ResolveProjectAuthority = (localWorkspaceId: string) => Promise<ProjectAuthorityTarget | null>

/** Domain-only connection inside RoutedClient. It never replaces the host workspace client. */
export class ProjectAuthorityConnection {
  private client: WsRpcClient | null = null
  private generation = 0
  private localWorkspaceId: string | null = null
  private target: ProjectAuthorityTarget | null = null
  private state: ProjectAuthorityState = 'unconfigured'
  private pending: Promise<void> = Promise.resolve()
  private listeners = new Set<() => void>()

  constructor(private readonly resolveTarget: ResolveProjectAuthority) {}

  getState(): ProjectAuthorityState { return this.state }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(state: ProjectAuthorityState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }

  setWorkspace(localWorkspaceId: string): Promise<void> {
    const generation = ++this.generation
    this.client?.destroy()
    this.client = null
    this.target = null
    this.localWorkspaceId = localWorkspaceId
    this.publish('connecting')
    this.pending = this.open(localWorkspaceId, generation)
    return this.pending
  }

  private async open(localWorkspaceId: string, generation: number): Promise<void> {
    try {
      const target = await this.resolveTarget(localWorkspaceId)
      if (generation !== this.generation) return
      if (!target) { this.publish('unconfigured'); return }
      const configuration = requireProjectAuthorityConfiguration({ url: target.url, workspaceId: target.workspaceId })
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(target.token)) throw new ProjectAuthorityError('AUTH_FAILED')
      const remote = { url: configuration.url, remoteWorkspaceId: configuration.workspaceId, token: target.token,
        tlsTrust: { mode: 'public-ca' as const } }
      const client = new WsRpcClient(configuration.url, {
        token: target.token, workspaceId: configuration.workspaceId,
        mode: 'remote', autoReconnect: true, clientCapabilities: [],
        ...peerTrustOptionsForRemote(remote),
        resolveTarget: async () => {
          const fresh = await this.resolveTarget(localWorkspaceId)
          if (generation !== this.generation || !fresh || fresh.url !== target.url || fresh.workspaceId !== target.workspaceId) {
            throw new ProjectAuthorityError('AUTH_FAILED')
          }
          return { url: fresh.url, token: fresh.token }
        },
      })
      this.target = target
      this.client = client
      client.onConnectionStateChanged(state => {
        if (generation !== this.generation) return
        this.publish(state.status === 'connected' ? 'ready'
          : state.status === 'failed' ? (state.lastError?.kind === 'auth' || state.lastError?.kind === 'protocol' ? 'denied' : 'unavailable')
          : state.status === 'connecting' || state.status === 'reconnecting' ? 'connecting' : 'unavailable')
      })
      client.connect()
    } catch {
      if (generation === this.generation) this.publish('denied')
    }
  }

  isAvailable(channel: string): boolean {
    return isProjectAuthorityChannel(channel) && this.state === 'ready' && this.client?.isChannelAvailable(channel) === true
  }

  async invoke(channel: string, ...arguments_: unknown[]): Promise<unknown> {
    if (!isProjectAuthorityChannel(channel)) throw new ProjectAuthorityError('CAPABILITY_UNAVAILABLE')
    const generation = this.generation
    await this.pending
    const client = this.client
    const target = this.target
    if (!client || !target || !this.isAvailable(channel)) throw new ProjectAuthorityError(this.state === 'denied' ? 'AUTH_FAILED' : 'CAPABILITY_UNAVAILABLE')
    if (generation !== this.generation || arguments_.length !== 2 || arguments_[0] !== this.localWorkspaceId) {
      throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
    }
    let body = arguments_[1]
    if (channel === DOMAIN_PROJECT_RPC.CREATE_SHARED && body && typeof body === 'object' && !Array.isArray(body)) {
      if (!('workspaceId' in body) || body.workspaceId !== this.localWorkspaceId) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      body = { ...body, workspaceId: target.workspaceId }
    }
    try {
      const result: unknown = await client.invoke(channel, target.workspaceId, body)
      if (generation !== this.generation) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
      return result
    } catch (error) {
      if (generation === this.generation && typeof error === 'object' && error !== null && 'code' in error
        && ['AUTH_FAILED', 'UNAUTHENTICATED'].includes(String(error.code))) this.publish('denied')
      throw error
    }
  }

  destroy(): void {
    ++this.generation
    this.client?.destroy()
    this.client = null
    this.target = null
    this.publish('unconfigured')
  }
}
