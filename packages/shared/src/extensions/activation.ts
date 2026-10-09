/**
 * Craft Extension activation planning (S-05 §3.4 / wave-3 f.7).
 *
 * Pure planner: decides, for every discovered craft-sandbox descriptor,
 * whether it activates now, defers until a later trigger, or is skipped —
 * and why. No filesystem, host or process access here; the Electron main side
 * (extension-host/startup.ts) executes `plannedLoads`.
 *
 * Activation events (manifest `activationEvents`):
 *   - undefined / []            → always active (activate at install time)
 *   - `onStartup`               → activate when the `startup` trigger is present
 *   - `onWorkspaceOpen`         → activate when the `workspace-open` trigger is present
 *   - `onCommand:<id>`          → defer until a `{kind:'command', id}` trigger
 *   - `onSurface:<kind>`        → defer until a `{kind:'surface', surface}` trigger
 *
 * Skip precedence (deterministic): descriptor-invalid → disabled →
 * not-host-executable → already-loaded → unknown-activation-event →
 * command-not-declared → trigger decision.
 */

import type { ExtensionManifest, ExtensionRuntime } from './types.ts'

/** A craft-sandbox package discovered on disk (descriptor plane, c2.5). */
export interface SandboxExtensionDescriptor {
  /** Manifest id (falls back to the package directory name when unparsable). */
  id: string
  /** Absolute package directory (real path when resolvable). */
  dir: string
  /** Absolute entry module path — present only when `status === 'ok'`. */
  entryPath?: string
  /** Parsed manifest — present only when the manifest validated. */
  manifest?: ExtensionManifest
  /** sha256 over manifest bytes + entry bytes + package file list. */
  descriptorHash?: string
  status: 'ok' | 'invalid'
  /** Human/machine-readable diagnostics when `status === 'invalid'`. */
  issues?: string[]
  /** Declared runtime (present once the manifest parsed). */
  runtime?: ExtensionRuntime
}

/** What is trying to activate extensions right now. */
export type ActivationTrigger =
  | 'startup'
  | 'workspace-open'
  | { kind: 'command'; id: string }
  | { kind: 'surface'; surface: string }

export type ActivationAction = 'activate-now' | 'defer' | 'skip'

/** One planner row. */
export interface ActivationPlanItem {
  id: string
  action: ActivationAction
  /** Machine-readable reason, e.g. 'activation-all' | 'disabled' | 'defer:onCommand:x'. */
  reason: string
  /** The trigger that matched (activate-now) or that would activate (defer). */
  trigger?: ActivationTrigger
}

export interface ActivationPlan {
  /** Deterministically sorted by id. */
  items: ActivationPlanItem[]
  /** Ids to load right now (action === 'activate-now'), sorted by id. */
  plannedLoads: string[]
}

export interface PlanExtensionActivationsInput {
  descriptors: SandboxExtensionDescriptor[]
  /** Enable/disable gate (extension state store). */
  enabled: (id: string) => boolean
  /** Triggers currently in effect (e.g. ['startup'], or a command trigger). */
  triggers: readonly ActivationTrigger[]
  /** Extension ids already loaded in the host — never loaded twice. */
  loaded: ReadonlySet<string>
}

export const ACTIVATION_EVENTS = {
  STARTUP: 'onStartup',
  WORKSPACE_OPEN: 'onWorkspaceOpen',
  COMMAND_PREFIX: 'onCommand:',
  SURFACE_PREFIX: 'onSurface:',
} as const

/**
 * Canonical wire command id for a command contributed by an extension.
 * `extension:<bareExtId>:<contributeId>` — the bare id has any redundant
 * `extension:` prefix stripped so namespacing is idempotent.
 */
export function extensionCommandId(
  extensionId: string,
  contributeId: string,
): string {
  const bare = extensionId.trim().replace(/^extension:/, '')
  return `extension:${bare}:${contributeId}`
}

function isKnownActivationEvent(event: string): boolean {
  if (event === ACTIVATION_EVENTS.STARTUP || event === ACTIVATION_EVENTS.WORKSPACE_OPEN) {
    return true
  }
  if (event.startsWith(ACTIVATION_EVENTS.COMMAND_PREFIX)) {
    return event.length > ACTIVATION_EVENTS.COMMAND_PREFIX.length
  }
  if (event.startsWith(ACTIVATION_EVENTS.SURFACE_PREFIX)) {
    return event.length > ACTIVATION_EVENTS.SURFACE_PREFIX.length
  }
  return false
}

/** Trigger that a single activation-event token waits for. */
function triggerForEvent(event: string): ActivationTrigger | undefined {
  if (event === ACTIVATION_EVENTS.STARTUP) return 'startup'
  if (event === ACTIVATION_EVENTS.WORKSPACE_OPEN) return 'workspace-open'
  if (event.startsWith(ACTIVATION_EVENTS.COMMAND_PREFIX)) {
    return { kind: 'command', id: event.slice(ACTIVATION_EVENTS.COMMAND_PREFIX.length) }
  }
  if (event.startsWith(ACTIVATION_EVENTS.SURFACE_PREFIX)) {
    return { kind: 'surface', surface: event.slice(ACTIVATION_EVENTS.SURFACE_PREFIX.length) }
  }
  return undefined
}

function matchesTrigger(
  event: string,
  triggers: readonly ActivationTrigger[],
): ActivationTrigger | undefined {
  const wanted = triggerForEvent(event)
  if (!wanted) return undefined
  for (const trigger of triggers) {
    if (wanted === 'startup' || wanted === 'workspace-open') {
      if (trigger === wanted) return trigger
      continue
    }
    if (typeof trigger === 'object' && typeof wanted === 'object') {
      if (trigger.kind === wanted.kind && trigger.kind === 'command' && wanted.kind === 'command') {
        if (trigger.id === wanted.id) return trigger
      } else if (
        trigger.kind === wanted.kind &&
        trigger.kind === 'surface' &&
        wanted.kind === 'surface'
      ) {
        if (trigger.surface === wanted.surface) return trigger
      }
    }
  }
  return undefined
}

/** Command ids declared by the manifest's `contributes.commands`. */
function declaredCommandIds(manifest: ExtensionManifest | undefined): Set<string> {
  const ids = new Set<string>()
  const commands = manifest?.contributes?.commands
  if (!Array.isArray(commands)) return ids
  for (const entry of commands) {
    if (entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string') {
      ids.add(entry.id)
    }
  }
  return ids
}

function planOne(
  descriptor: SandboxExtensionDescriptor,
  enabled: boolean,
  triggers: readonly ActivationTrigger[],
  loaded: ReadonlySet<string>,
): ActivationPlanItem {
  const id = descriptor.id
  const skip = (reason: string): ActivationPlanItem => ({ id, action: 'skip', reason })

  if (descriptor.status !== 'ok' || !descriptor.manifest) {
    return skip('descriptor-invalid')
  }
  if (!enabled) return skip('disabled')
  if (descriptor.manifest.runtime !== 'craft-sandbox') {
    return skip('not-host-executable')
  }
  if (loaded.has(id)) return skip('already-loaded')

  const events = descriptor.manifest.activationEvents
  if (!events || events.length === 0) {
    return { id, action: 'activate-now', reason: 'activation-all' }
  }

  if (events.some((event) => !isKnownActivationEvent(event))) {
    return skip('unknown-activation-event')
  }

  const declared = declaredCommandIds(descriptor.manifest)
  const commandEvents = events.filter((event) =>
    event.startsWith(ACTIVATION_EVENTS.COMMAND_PREFIX),
  )
  if (
    commandEvents.some(
      (event) => !declared.has(event.slice(ACTIVATION_EVENTS.COMMAND_PREFIX.length)),
    )
  ) {
    return skip('command-not-declared')
  }

  for (const event of events) {
    const matched = matchesTrigger(event, triggers)
    if (matched) {
      return { id, action: 'activate-now', reason: 'activation-event', trigger: matched }
    }
  }

  const deferred = triggerForEvent(events[0]!)
  return {
    id,
    action: 'defer',
    reason: `defer:${events[0]}`,
    ...(deferred ? { trigger: deferred } : {}),
  }
}

/**
 * Plan activation for every descriptor. Pure and deterministic: rows are
 * sorted by id and planned loads preserve that order.
 */
export function planExtensionActivations(
  input: PlanExtensionActivationsInput,
): ActivationPlan {
  const items = input.descriptors
    .map((descriptor) =>
      planOne(
        descriptor,
        input.enabled(descriptor.id),
        input.triggers,
        input.loaded,
      ),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  return {
    items,
    plannedLoads: items.filter((i) => i.action === 'activate-now').map((i) => i.id),
  }
}