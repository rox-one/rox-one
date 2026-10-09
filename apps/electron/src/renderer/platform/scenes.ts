/**
 * Сцены (D8 / W2.2). A Scene is a saved pill layout: an ordered list of
 * surface ids (the same ids the pill composition uses). Scenes live in
 * localStorage under `craft-workbench-scenes-v1` and are exposed through a
 * `useSyncExternalStore` binding, mirroring `pill-composition.ts`.
 *
 * The module is storage-and-data only: it never resolves ids against the mode
 * registry (that is `pill-composition.ts`). A Scene is the PRIORITY source of
 * the pill composition: while one is active its ordered `surfaceIds` define
 * the pill, overriding frequency ordering and manual pins. Clearing the active
 * scene restores the automatic composition.
 *
 * Namespaced like the renderer's `craft-*` keys (`lib/local-storage.ts`).
 */
import { useSyncExternalStore } from 'react'

export interface Scene {
  id: string
  name: string
  /** Ordered surface ids (pill composition ids, or bare registry mode ids). */
  surfaceIds: string[]
  createdAt: number
}

export interface ScenesState {
  scenes: Scene[]
  /** Id of the active scene, or `null` for the automatic composition. */
  activeSceneId: string | null
}

/** Namespaced like the renderer's `craft-*` keys (`lib/local-storage.ts`). */
export const SCENES_STORAGE_KEY = 'craft-workbench-scenes-v1'

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

function emptyState(): ScenesState {
  return { scenes: [], activeSceneId: null }
}

function sanitizeScene(value: unknown): Scene | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Scene>
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.name !== 'string') return null
  if (!Array.isArray(raw.surfaceIds)) return null
  const surfaceIds = raw.surfaceIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return {
    id: raw.id,
    name: raw.name,
    surfaceIds: dedupe(surfaceIds),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  }
}

/** Preserve first occurrence order, drop duplicates. */
function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function readScenesState(): ScenesState {
  const raw = storage()?.getItem(SCENES_STORAGE_KEY)
  if (!raw) return emptyState()
  try {
    const parsed = JSON.parse(raw) as Partial<ScenesState>
    const scenes = Array.isArray(parsed.scenes)
      ? parsed.scenes.map(sanitizeScene).filter((scene): scene is Scene => scene !== null)
      : []
    const activeSceneId =
      typeof parsed.activeSceneId === 'string' && scenes.some((scene) => scene.id === parsed.activeSceneId)
        ? parsed.activeSceneId
        : null
    return { scenes, activeSceneId }
  } catch {
    return emptyState()
  }
}

function writeScenesState(state: ScenesState): void {
  try {
    storage()?.setItem(SCENES_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota / private mode: keep the in-memory copy */
  }
}

let currentState: ScenesState | null = null
const listeners = new Set<() => void>()

function getState(): ScenesState {
  if (!currentState) currentState = readScenesState()
  return currentState
}

function commit(next: ScenesState): void {
  currentState = next
  writeScenesState(next)
  for (const listener of listeners) listener()
}

export function subscribeScenes(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Current in-memory state (storage-backed on first read). */
export function scenesSnapshot(): ScenesState {
  return getState()
}

/** React binding: re-renders the pill the moment a scene is saved/applied/cleared. */
export function useScenes(): ScenesState {
  return useSyncExternalStore(subscribeScenes, getState, getState)
}

// --- pure reducers (unit-testable, no storage) ------------------------------

/** Append a scene and make it active (saving a scene applies it immediately). */
export function addScene(state: ScenesState, scene: Scene): ScenesState {
  return { scenes: [...state.scenes, scene], activeSceneId: scene.id }
}

/** Replace a scene's name; a blank name is ignored. */
export function renameSceneIn(state: ScenesState, id: string, name: string): ScenesState {
  const trimmed = name.trim()
  if (!trimmed) return state
  return {
    ...state,
    scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, name: trimmed } : scene)),
  }
}

/** Remove a scene; the active scene is cleared when it was the one removed. */
export function removeScene(state: ScenesState, id: string): ScenesState {
  return {
    scenes: state.scenes.filter((scene) => scene.id !== id),
    activeSceneId: state.activeSceneId === id ? null : state.activeSceneId,
  }
}

/** Set the active scene; unknown ids resolve to the automatic composition. */
export function activateScene(state: ScenesState, id: string | null): ScenesState {
  const known = id !== null && state.scenes.some((scene) => scene.id === id)
  return { ...state, activeSceneId: known ? id : null }
}

// --- imperative CRUD (commits to the store) ---------------------------------

let sceneSeq = 0

function newSceneId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `scene-${cryptoApi.randomUUID()}`
  sceneSeq += 1
  return `scene-${Date.now().toString(36)}-${sceneSeq}`
}

/**
 * Save the given surface ids as a named scene and activate it. Returns the
 * created scene (`null` when the name is blank).
 */
export function createScene(name: string, surfaceIds: readonly string[], now: number = Date.now()): Scene | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const scene: Scene = { id: newSceneId(), name: trimmed, surfaceIds: dedupe(surfaceIds), createdAt: now }
  commit(addScene(getState(), scene))
  return scene
}

export function renameScene(id: string, name: string): void {
  commit(renameSceneIn(getState(), id, name))
}

export function deleteScene(id: string): void {
  commit(removeScene(getState(), id))
}

/** Activate a saved scene (its composition rebuilds the pill immediately). */
export function applyScene(id: string): void {
  commit(activateScene(getState(), id))
}

/** Clear the active scene and return to the automatic composition. */
export function clearScene(): void {
  commit(activateScene(getState(), null))
}

/** The active scene object, or `null`. */
export function activeScene(state: ScenesState = getState()): Scene | null {
  if (!state.activeSceneId) return null
  return state.scenes.find((scene) => scene.id === state.activeSceneId) ?? null
}

/** Test/idle seam: drop the in-memory copy and listeners. */
export function __resetScenesForTests(): void {
  currentState = null
  listeners.clear()
}