/**
 * Surface context over the existing Rox2Context seam (issue #338).
 * Do not invent a second context contract.
 */

import type { Rox2Context, Rox2Permission } from './platform-contract.ts'

export type ContextBindingPolicy = 'snapshot' | 'live'

export type SurfaceContextEnvelope = Rox2Context & {
  policy: ContextBindingPolicy
  tokenEstimate: number
  closedSourceIds: readonly string[]
}

export type ContextBinding = {
  id: string
  surfaceId: string
  sessionId: string
  policy: ContextBindingPolicy
  envelope: SurfaceContextEnvelope
}

export function closedSourceDenied(sourceId: string, closedSourceIds: readonly string[]): boolean {
  return closedSourceIds.includes(sourceId)
}

function tokenEstimateFor(context: Rox2Context): number {
  if (typeof context.snapshotBudgetTokens === 'number') return context.snapshotBudgetTokens
  const selectionChars = context.selection?.text?.length ?? 0
  return Math.max(1, context.entityRefs.length * 32 + Math.ceil(selectionChars / 4))
}

export function bindSurfaceContext(input: {
  context: Rox2Context
  policy: ContextBindingPolicy
  closedSourceIds?: readonly string[]
}): SurfaceContextEnvelope {
  const closed = input.closedSourceIds ?? []
  const entityRefs = input.context.entityRefs.filter((ref) => !closedSourceDenied(ref, closed))
  const revisions = { ...(input.context.revisions ?? {}) }
  for (const id of closed) delete revisions[id]
  return {
    ...input.context,
    entityRefs,
    revisions,
    policy: input.policy,
    tokenEstimate: tokenEstimateFor({ ...input.context, entityRefs }),
    closedSourceIds: closed,
  }
}

export class SurfaceContextProvider {
  private bindings = new Map<string, ContextBinding>()

  bind(input: {
    surfaceId: string
    sessionId: string
    context: Rox2Context
    policy?: ContextBindingPolicy
    closedSourceIds?: readonly string[]
  }): ContextBinding {
    const key = `${input.surfaceId}::${input.sessionId}`
    const existing = this.bindings.get(key)
    const envelope = bindSurfaceContext({
      context: input.context,
      policy: input.policy ?? existing?.policy ?? 'snapshot',
      closedSourceIds: input.closedSourceIds,
    })
    if (existing) {
      existing.envelope = envelope
      existing.policy = envelope.policy
      return existing
    }
    const binding: ContextBinding = {
      id: key,
      surfaceId: input.surfaceId,
      sessionId: input.sessionId,
      policy: envelope.policy,
      envelope,
    }
    this.bindings.set(key, binding)
    return binding
  }

  get(surfaceId: string, sessionId: string): ContextBinding | undefined {
    return this.bindings.get(`${surfaceId}::${sessionId}`)
  }

  unbind(surfaceId: string, sessionId: string): boolean {
    return this.bindings.delete(`${surfaceId}::${sessionId}`)
  }
}
