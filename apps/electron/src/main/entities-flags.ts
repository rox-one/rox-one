/**
 * Main-process owner of the effective `entities.links.v1` state.
 *
 * The renderer owns the persisted user toggle (Settings → localStorage atom)
 * and reports it to main; main is the single place that combines it with the
 * `CRAFT_FEATURE_ENTITIES_LINKS` env override (which the context-isolated
 * renderer cannot read) and publishes the EFFECTIVE state back:
 *
 * - `entities:syncLinksState` (sendSync) — renderer bootstrap, before the
 *   first React render: reports the persisted toggle, returns the effective
 *   state so the renderer route gate is correct for restored tabs.
 * - `entities:setLinksEnabled` (invoke) — Settings toggle; returns the
 *   effective state.
 * - `entities:linksStateChanged` (main → every window) — effective state
 *   changed, so all windows (and their Settings toggles) agree.
 *
 * Main applies the persisted value to both consumers that live in this
 * process: the shared deep-link parser (`setEntityRoutesEnabled`; the env
 * override applies inside `isEntitiesLinksEnabled`) and the server-core live
 * workbench-flag source. Main, renderer and server therefore always agree.
 *
 * Durable copy: main persists the last reported toggle to
 * `<configDir>/entities-links.json` and reads it at boot, so cold-start
 * deep links (`rox://docs/…`) are parsed against the user's real setting
 * before any renderer has mounted. When no durable copy exists yet (first
 * launch with this build), entity deep links are held until the first
 * renderer report (`whenEntitiesLinksFlagKnown`, 10 s timeout).
 *
 * Registered unconditionally — thin clients (`CRAFT_SERVER_URL`) need the
 * local deep-link gate too; a remote server only sees its own env override
 * (documented W1 limitation).
 */

import type { IpcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import {
  parseEntitiesLinksEnvOverride,
  resolveEntitiesLinksEffectiveState,
  type EntitiesLinksEffectiveState,
} from '@rox/shared/feature-flags'
import { atomicWriteFileSync, readJsonFileSync } from '@rox/shared/utils/files'
import { setEntitiesWorkbenchFlags } from '@rox/server-core/entities/workbench-flags'
import { setEntityRoutesEnabled } from '../shared/route-parser'

export const ENTITIES_LINKS_IPC = {
  SET: 'entities:setLinksEnabled',
  SYNC: 'entities:syncLinksState',
  CHANGED: 'entities:linksStateChanged',
} as const

export const ENTITIES_LINKS_STATE_FILE = 'entities-links.json'

/** How long a cold-start entity deep link waits for the first renderer report. */
export const ENTITIES_FLAG_WAIT_MS = 10_000

type Listener = (state: EntitiesLinksEffectiveState) => void
type Logger = Pick<Console, 'warn' | 'error'>

let persisted = false
let known = false
let stateFile: string | null = null
let logger: Logger = console
let lastPublished: EntitiesLinksEffectiveState | null = null
const listeners = new Set<Listener>()
const waiters = new Set<() => void>()

/** Effective state: env override > persisted toggle (default OFF). */
export function getEntitiesLinksState(): EntitiesLinksEffectiveState {
  return resolveEntitiesLinksEffectiveState(persisted)
}

/**
 * True once main knows the user's setting: a durable copy was read, a
 * renderer reported, or the env override decides on its own.
 */
export function isEntitiesLinksFlagKnown(): boolean {
  return known || parseEntitiesLinksEnvOverride() !== undefined
}

/**
 * Resolves `true` as soon as the flag is known (immediately when it already
 * is), or `false` after `timeoutMs`.
 */
export function whenEntitiesLinksFlagKnown(timeoutMs: number = ENTITIES_FLAG_WAIT_MS): Promise<boolean> {
  if (isEntitiesLinksFlagKnown()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      clearTimeout(timer)
      waiters.delete(onKnown)
      resolve(value)
    }
    const onKnown = () => done(true)
    const timer = setTimeout(() => done(false), Math.max(0, timeoutMs))
    waiters.add(onKnown)
  })
}

function markKnown(): void {
  if (known) return
  known = true
  for (const notify of [...waiters]) notify()
}

function sameState(a: EntitiesLinksEffectiveState | null, b: EntitiesLinksEffectiveState): boolean {
  return !!a && a.enabled === b.enabled && a.persisted === b.persisted && a.envOverride === b.envOverride
}

function publish(): EntitiesLinksEffectiveState {
  const state = getEntitiesLinksState()
  if (!sameState(lastPublished, state)) {
    lastPublished = state
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch (error) {
        logger.error('[entities] linksStateChanged listener failed:', error)
      }
    }
  }
  return state
}

function applyToConsumers(enabled: boolean): void {
  setEntityRoutesEnabled(enabled)
  setEntitiesWorkbenchFlags(enabled ? [WORKBENCH_FLAG.entitiesLinksV1] : [])
}

function persist(enabled: boolean): void {
  if (!stateFile) return
  try {
    atomicWriteFileSync(stateFile, `${JSON.stringify({ enabled })}\n`)
  } catch (error) {
    logger.error('[entities] failed to persist entities.links.v1 durable copy:', error)
  }
}

/**
 * Apply the renderer-reported persisted toggle. Returns the effective state
 * (what the renderer must use for its route gate and Settings UI).
 */
export function applyEntitiesLinksFlag(enabled: boolean): EntitiesLinksEffectiveState {
  const changed = enabled !== persisted || !known
  persisted = enabled
  applyToConsumers(enabled)
  if (changed) persist(enabled)
  markKnown()
  return publish()
}

/**
 * Boot: read the durable copy from `<configDir>/entities-links.json`.
 * Missing or malformed → stays default OFF and *unknown*, so cold-start
 * entity deep links wait for the first renderer report.
 */
export function loadPersistedEntitiesLinksFlag(configDir: string, options: { logger?: Logger } = {}): boolean | undefined {
  if (options.logger) logger = options.logger
  stateFile = join(configDir, ENTITIES_LINKS_STATE_FILE)
  if (!existsSync(stateFile)) {
    applyToConsumers(persisted)
    lastPublished = getEntitiesLinksState()
    return undefined
  }
  try {
    const raw = readJsonFileSync<{ enabled?: unknown }>(stateFile)
    if (typeof raw?.enabled !== 'boolean') throw new Error('entities-links.json: "enabled" must be a boolean')
    persisted = raw.enabled
    applyToConsumers(persisted)
    markKnown()
    lastPublished = getEntitiesLinksState()
    return persisted
  } catch (error) {
    logger.warn('[entities] ignoring unreadable entities.links.v1 durable copy:', error)
    applyToConsumers(persisted)
    lastPublished = getEntitiesLinksState()
    return undefined
  }
}

/** Subscribe to effective-state changes (main broadcasts them to windows). */
export function onEntitiesLinksStateChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test seam: back to the cold-start state. */
export function __resetEntitiesLinksFlagForTests(): void {
  persisted = false
  known = false
  stateFile = null
  logger = console
  lastPublished = null
  listeners.clear()
  waiters.clear()
  applyToConsumers(false)
}

export interface EntitiesLinksIpcOptions {
  /** Send the effective state to every renderer (index.ts wires webContents). */
  broadcast?: (channel: string, state: EntitiesLinksEffectiveState) => void
}

let unsubscribeBroadcast: (() => void) | null = null

/**
 * Register the renderer ↔ main channels. Call unconditionally (local, thin
 * client and headless hosts) and before the first window loads.
 */
export function registerEntitiesLinksIpc(ipcMain: Pick<IpcMain, 'handle' | 'on'>, options: EntitiesLinksIpcOptions = {}): void {
  ipcMain.handle(ENTITIES_LINKS_IPC.SET, async (_event, enabled: unknown) => applyEntitiesLinksFlag(enabled === true))
  ipcMain.on(ENTITIES_LINKS_IPC.SYNC, (event, enabled: unknown) => {
    try {
      event.returnValue = applyEntitiesLinksFlag(enabled === true)
    } catch (error) {
      logger.error('[entities] syncLinksState failed:', error)
      event.returnValue = getEntitiesLinksState()
    }
  })
  unsubscribeBroadcast?.()
  unsubscribeBroadcast = null
  const broadcast = options.broadcast
  if (broadcast) {
    unsubscribeBroadcast = onEntitiesLinksStateChanged(state => broadcast(ENTITIES_LINKS_IPC.CHANGED, state))
  }
}
