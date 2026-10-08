import type { TourBinding, TourScope } from '../contracts'
import type { TourObservation } from './hooks'
import type { CollectionViewMode } from '../../../components/app-shell/kanban/BoardListToggle'

interface ViewRequest {
  readonly observation: TourObservation
  readonly value: CollectionViewMode
  readonly expiresAt: number
  mounted: boolean
  emitted: boolean
}
// One renderer runtime owns its requests; replacing a route host must not lose
// them, and another provider/profile must never inherit them. No timers run.
const requests = new WeakMap<object, Map<string, ViewRequest>>()
const MAX_REQUESTS = 32
const REQUEST_TTL = 15_000
const key = (binding: TourBinding) => JSON.stringify([binding.clientProfileId, binding.workspaceId,
  binding.panelId, binding.sessionId ?? null, binding.entityId ?? null, binding.runToken])

function prune(records: Map<string, ViewRequest>, now: number) {
  for (const [id, request] of records) if (!request.mounted && request.expiresAt <= now) records.delete(id)
}

export function beginCollectionViewChange(owner: object, observation: TourObservation | null,
  value: CollectionViewMode, previous: CollectionViewMode, now = Date.now()): void {
  if (!observation) return
  const records = requests.get(owner) ?? new Map<string, ViewRequest>()
  prune(records, now)
  const id = key(observation.binding)
  if (value === previous) {
    // Re-selecting the mounted view is a no-op; its selected-session custody
    // must remain valid while the user is still acknowledging this step.
    const current = records.get(id)
    if (!current?.mounted || current.value !== value) records.delete(id)
    return
  }
  records.delete(id)
  while (records.size >= MAX_REQUESTS) records.delete(records.keys().next().value!)
  records.set(id, { observation, value, expiresAt: now + REQUEST_TTL, mounted: false, emitted: false })
  requests.set(owner, records)
}

function matchedRequest(owner: object, binding: TourBinding, scope: TourScope, value: unknown, now: number): ViewRequest | null {
  const records = requests.get(owner)
  if (!records) return null
  prune(records, now)
  const request = records.get(key(binding))
  // Table and heatmap intentionally render an entire collection without a
  // selected session. Only this exact captured request may retain that source
  // session internally; selecting a different session/entity remains forbidden.
  if (!request || request.value !== value || scope.workspaceId !== binding.workspaceId || scope.panelId !== binding.panelId
    || scope.entityId !== binding.entityId || (scope.sessionId !== undefined && scope.sessionId !== binding.sessionId)) return null
  return request
}

/** Navigation permission is narrow and does not itself manufacture evidence. */
export function hasCollectionViewChange(owner: object, binding: TourBinding, scope: TourScope,
  value: unknown, now = Date.now()): boolean {
  return matchedRequest(owner, binding, scope, value, now) !== null
}

/** Called only after the requested, measured destination DOM has committed. */
export function consumeCollectionViewChange(owner: object, current: TourObservation | null, scope: TourScope,
  value: CollectionViewMode, visible: boolean, now = Date.now()): TourObservation | null {
  if (!current || !visible) return null
  const request = matchedRequest(owner, current.binding, scope, value, now)
  if (!request || request.emitted) return null
  request.mounted = true
  request.emitted = true
  return request.observation
}

/** Provider pause/disable/reset/unmount and step/attempt changes retire custody. */
export function clearCollectionViewChanges(owner: object): void { requests.delete(owner) }
