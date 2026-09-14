/**
 * Selected-screen context for meeting assist (issue #370 / I014).
 * One window/tab — never every monitor. Binds into SurfaceContextProvider (#338).
 * Screen-share exclusion is a best-effort OS capability, not universal invisibility.
 * Does not create a second overlay window.
 */

import {
  SurfaceContextProvider,
  type ContextBinding,
  type Rox2Context,
} from '@craft-agent/core/rox2'
import {
  authorizeMeetingAction,
  revokeGrant,
  type MeetingActor,
  type MeetingGrant,
} from '@craft-agent/shared/meeting-agents'

export type ScreenSourceKind = 'window' | 'tab' | 'display'

export type ScreenSource = {
  id: string
  kind: ScreenSourceKind
  name: string
  revision: string
}

export type ScreenFrame = {
  sourceId: string
  revision: string
  capturedAt: number
  text?: string
  preview?: string
}

export type ScreenCaptureDriver = {
  listSources(): readonly ScreenSource[] | Promise<readonly ScreenSource[]>
  captureFrame(sourceId: string): ScreenFrame | null | Promise<ScreenFrame | null>
  applyExclusion?(sourceId: string): { attempted: boolean; supported: boolean }
}

export type ScreenContextSnapshot = {
  selected?: ScreenSource
  available: boolean
  preview?: { sourceId: string; revision: string }
  capturing: boolean
  revoked: boolean
  error?: string
  framesCaptured: number
  framesAfterRevoke: number
  captureExclusion: { attempted: boolean; supported: boolean }
}

export type MeetingScreenContextOptions = {
  workspaceId: string
  meetingId: string
  sessionId: string
  actor: MeetingActor
  grants: readonly MeetingGrant[]
  now?: number
  driver?: ScreenCaptureDriver
  provider?: SurfaceContextProvider
  closedSourceIds?: readonly string[]
  snapshotBudgetTokens?: number
}

function sourceRef(source: Pick<ScreenSource, 'id' | 'revision'>, workspaceId: string): string {
  if (source.id.includes(':') && source.id.includes('@')) return source.id
  return `source:${workspaceId}:${source.id}@${source.revision}`
}

export class MeetingScreenContext {
  private selectedId: string | undefined
  private selectedRevision: string | undefined
  private sources: ScreenSource[] = []
  private preview: { sourceId: string; revision: string } | undefined
  private capturing = false
  private revoked = false
  private error: string | undefined
  private framesCaptured = 0
  private framesAfterRevoke = 0
  private captureExclusion = { attempted: false, supported: false }
  private generation = 0
  private readonly provider: SurfaceContextProvider
  private grants: MeetingGrant[]

  constructor(private readonly options: MeetingScreenContextOptions) {
    this.provider = options.provider ?? new SurfaceContextProvider()
    this.grants = [...options.grants]
  }

  snapshot(): ScreenContextSnapshot {
    return {
      selected: this.selectedSource(),
      available: this.selectedAvailable(),
      preview: this.preview,
      capturing: this.capturing && !this.revoked,
      revoked: this.revoked,
      error: this.error,
      framesCaptured: this.framesCaptured,
      framesAfterRevoke: this.framesAfterRevoke,
      captureExclusion: { ...this.captureExclusion },
    }
  }

  providerBinding(): ContextBinding | undefined {
    return this.provider.get(this.surfaceId(), this.options.sessionId)
  }

  surfaceProvider(): SurfaceContextProvider {
    return this.provider
  }

  async refreshSources(): Promise<readonly ScreenSource[]> {
    if (!this.options.driver) {
      this.sources = []
      return []
    }
    this.sources = [...await this.options.driver.listSources()]
    if (this.selectedId && !this.sources.some((source) => sourceRef(source, this.options.workspaceId) === this.selectedId || source.id === this.selectedId)) {
      this.error = 'selected-unavailable'
    }
    return this.sources
  }

  async selectSource(input: { sourceId: string; allDisplays?: boolean; now?: number }): Promise<ScreenContextSnapshot> {
    if (input.allDisplays) {
      this.error = 'all-displays-denied'
      return this.snapshot()
    }
    const auth = this.authorize(input.now ?? this.options.now ?? 0, input.sourceId)
    if (!auth.ok) {
      this.error = auth.code
      return this.snapshot()
    }
    if (this.sources.length === 0) await this.refreshSources()
    const found = this.sources.find((source) => source.id === input.sourceId || sourceRef(source, this.options.workspaceId) === input.sourceId)
    if (!found) {
      this.error = 'source-missing'
      return this.snapshot()
    }
    if (found.kind === 'display' && this.sources.filter((source) => source.kind === 'display').length > 1 && input.sourceId === '*') {
      this.error = 'all-displays-denied'
      return this.snapshot()
    }
    this.selectedId = sourceRef(found, this.options.workspaceId)
    this.selectedRevision = found.revision
    this.error = undefined
    this.bindSnapshot(found)
    this.captureExclusion = this.options.driver?.applyExclusion?.(found.id) ?? { attempted: false, supported: false }
    return this.snapshot()
  }

  async previewSelected(now?: number): Promise<ScreenContextSnapshot> {
    const selected = this.selectedSource()
    if (!selected) {
      this.error = 'no-selection'
      return this.snapshot()
    }
    const frame = await this.captureFrame({ now, enqueue: false })
    if (frame) this.preview = { sourceId: frame.sourceId, revision: frame.revision }
    return this.snapshot()
  }

  async captureFrame(input: { now?: number; allDisplays?: boolean; enqueue?: boolean } = {}): Promise<ScreenFrame | null> {
    if (input.allDisplays) {
      this.error = 'all-displays-denied'
      return null
    }
    if (this.revoked) {
      this.framesAfterRevoke += 1
      this.error = 'screen-revoked'
      this.capturing = false
      return null
    }
    const selected = this.selectedSource()
    if (!selected) {
      this.error = 'no-selection'
      return null
    }
    if (!this.selectedAvailable()) {
      this.error = 'selected-unavailable'
      return null
    }
    const auth = this.authorize(input.now ?? this.options.now ?? 0, selected.id)
    if (!auth.ok) {
      this.error = auth.code
      return null
    }
    if (!this.options.driver) {
      this.error = 'no-driver'
      return null
    }
    const generation = this.generation
    this.capturing = true
    const frame = await this.options.driver.captureFrame(selected.id.includes(':') ? stripSourceId(selected.id) : selected.id)
    if (this.revoked || generation !== this.generation) {
      this.framesAfterRevoke += 1
      this.capturing = false
      return null
    }
    if (!frame) {
      this.error = 'capture-empty'
      this.capturing = false
      return null
    }
    const bound: ScreenFrame = {
      ...frame,
      sourceId: sourceRef({ id: frame.sourceId, revision: frame.revision }, this.options.workspaceId),
    }
    if (bound.sourceId !== this.selectedId) {
      this.error = 'scope-drift'
      return null
    }
    this.framesCaptured += 1
    this.bindSnapshot(selected, bound)
    if (input.enqueue === false) this.capturing = false
    return bound
  }

  revoke(now?: number): ScreenContextSnapshot {
    this.generation += 1
    this.revoked = true
    this.capturing = false
    this.grants = this.grants.map((grant) => revokeGrant(grant, now ?? this.options.now ?? 0))
    this.error = 'screen-revoked'
    return this.snapshot()
  }

  private selectedSource(): ScreenSource | undefined {
    if (!this.selectedId) return undefined
    const listed = this.sources.find((source) => sourceRef(source, this.options.workspaceId) === this.selectedId || source.id === this.selectedId)
    if (listed) return { ...listed, id: sourceRef(listed, this.options.workspaceId) }
    if (this.selectedRevision) {
      return {
        id: this.selectedId,
        kind: 'window',
        name: 'unavailable',
        revision: this.selectedRevision,
      }
    }
    return undefined
  }

  private selectedAvailable(): boolean {
    if (!this.selectedId) return false
    return this.sources.some((source) => sourceRef(source, this.options.workspaceId) === this.selectedId || source.id === this.selectedId)
  }

  private surfaceId(): string {
    return `meeting-screen:${this.options.meetingId}`
  }

  private authorize(now: number, target: string) {
    return authorizeMeetingAction({
      actor: this.options.actor,
      capability: 'capture.screen',
      operation: 'screen-context',
      source: 'screen',
      target,
      payloadHash: 'screen-context',
      now,
      permissionMode: 'ask',
      grants: this.grants,
    })
  }

  private bindSnapshot(selected: ScreenSource, frame?: ScreenFrame): void {
    const selectedId = sourceRef(selected, this.options.workspaceId)
    const closed = [
      ...(this.options.closedSourceIds ?? []),
      ...this.sources
        .map((source) => sourceRef(source, this.options.workspaceId))
        .filter((id) => id !== selectedId),
    ]
    const context: Rox2Context = {
      workspaceId: this.options.workspaceId,
      sessionId: this.options.sessionId,
      surfaceId: this.surfaceId(),
      entityRefs: [selectedId],
      permissionMode: 'ask',
      revisions: { [selectedId]: selected.revision },
      selection: frame?.text ? { text: frame.text } : undefined,
      snapshotBudgetTokens: this.options.snapshotBudgetTokens ?? 256,
    }
    this.provider.bind({
      surfaceId: this.surfaceId(),
      sessionId: this.options.sessionId,
      context,
      policy: 'snapshot',
      closedSourceIds: closed,
    })
  }
}

function stripSourceId(ref: string): string {
  const match = /^source:[^:]+:([^@]+)@/.exec(ref)
  return match?.[1] ?? ref
}
