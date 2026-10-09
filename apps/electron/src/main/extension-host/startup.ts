/**
 * craft-sandbox startup activation (S-05 §3.5 / wave-3 f.7).
 *
 * Discovers descriptors (descriptors.ts), plans activation (shared
 * activation.ts) and loads the `activate-now` set into the per-workspace
 * Extension Host. Grants come exclusively from the workspace permissions.json
 * (`resolveExtensionGrantsFromPermissions`) — never from renderer input.
 *
 * Failure isolation: one extension failing to load never aborts the batch.
 * Idempotency: already-loaded extensions are planned `already-loaded` and are
 * never re-loaded (the host manager also unloads before load).
 */

import { resolveConfigDir } from '@rox/shared/config/paths'
import {
  extensionCommandId,
  getExtensionStateStore,
  planExtensionActivations,
  type ActivationPlanItem,
  type ActivationTrigger,
  type ExtensionCommandDescriptor,
  type SandboxExtensionDescriptor,
} from '@rox/shared/extensions'
import type { PushTarget } from '@rox/shared/protocol'
import { RPC_CHANNELS } from '../../shared/types'
import { getExtensionHostManager } from '../extension-host-manager'
import { loadSandboxExtensionDescriptors } from './descriptors'
import { resolveExtensionGrantsFromPermissions } from './grants'

/** Typed activation refusals for `extensionHost:activate`. */
export type ExtensionActivationErrorCode =
  | 'EXTENSION_DISABLED'
  | 'DESCRIPTOR_INVALID'
  | 'EXTENSION_NOT_EXECUTABLE'
  | 'HOST_UNAVAILABLE'

export class ExtensionActivationError extends Error {
  readonly code: ExtensionActivationErrorCode

  constructor(code: ExtensionActivationErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'ExtensionActivationError'
    this.code = code
  }
}

/** Event sink shaped like the RPC server push (channel, target, payload). */
export type ExtensionHostPushFn = (
  channel: string,
  target: PushTarget,
  payload: { workspaceId?: string; reason: 'state' },
) => void

export interface SandboxDescriptorListing {
  descriptors: SandboxExtensionDescriptor[]
  plan: ActivationPlanItem[]
  loaded: string[]
}

/** Triggers implied when merely listing descriptors (no explicit event yet). */
const LISTING_TRIGGERS: readonly ActivationTrigger[] = ['startup', 'workspace-open']

/**
 * Descriptors + activation plan + currently loaded ids. Never forks the host:
 * descriptor discovery is a pure filesystem scan and `getStatus()` is a
 * snapshot.
 */
export function listSandboxDescriptors(options: {
  workspaceId?: string | null
  configDir?: string
  sandboxRootEnv?: string
  triggers?: readonly ActivationTrigger[]
}): SandboxDescriptorListing {
  const configDir = options.configDir ?? resolveConfigDir()
  const manager = getExtensionHostManager(options.workspaceId)
  const loaded = manager.getStatus().loadedExtensions ?? []
  const descriptors = loadSandboxExtensionDescriptors({
    configDir,
    sandboxRootEnv: options.sandboxRootEnv,
  })
  const store = getExtensionStateStore(configDir)
  const plan = planExtensionActivations({
    descriptors,
    enabled: (id) => store.isEnabled(id),
    triggers: options.triggers ?? LISTING_TRIGGERS,
    loaded: new Set(loaded),
  })
  return { descriptors, plan: plan.items, loaded }
}

export interface StartupActivationResult {
  activated: string[]
  failures: Array<{ extensionId: string; error: string }>
  plan: ActivationPlanItem[]
}

/**
 * Load every `activate-now` extension for the given trigger.
 * `push` (when supplied) emits `extensions:changed` if anything loaded.
 */
export async function applyStartupActivations(options: {
  workspaceId?: string | null
  trigger: ActivationTrigger
  configDir?: string
  sandboxRootEnv?: string
  push?: ExtensionHostPushFn
}): Promise<StartupActivationResult> {
  const configDir = options.configDir ?? resolveConfigDir()
  const manager = getExtensionHostManager(options.workspaceId)
  const descriptors = loadSandboxExtensionDescriptors({
    configDir,
    sandboxRootEnv: options.sandboxRootEnv,
  })
  const store = getExtensionStateStore(configDir)
  const plan = planExtensionActivations({
    descriptors,
    enabled: (id) => store.isEnabled(id),
    triggers: [options.trigger],
    loaded: new Set(manager.getStatus().loadedExtensions ?? []),
  })

  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
  const activated: string[] = []
  const failures: StartupActivationResult['failures'] = []

  for (const id of plan.plannedLoads) {
    const descriptor = byId.get(id)
    if (!descriptor?.entryPath || !descriptor.manifest) continue
    try {
      // Fresh grants each run — a revoke between runs must take effect.
      const grants = resolveExtensionGrantsFromPermissions(options.workspaceId, id)
      await manager.loadExtension(
        id,
        descriptor.entryPath,
        grants,
        descriptor.manifest.operations ?? {},
      )
      activated.push(id)
    } catch (err) {
      failures.push({ extensionId: id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (activated.length > 0 && options.push) {
    options.push(RPC_CHANNELS.extensions.CHANGED, { to: 'all' }, {
      reason: 'state',
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    })
  }

  return { activated, failures, plan: plan.items }
}

/** Message shapes that mean the host process itself is unusable. */
const HOST_FAILURE_RE =
  /not running|no utilityProcess|ready timeout|process exited|has no child|app not ready/i

/**
 * Explicitly activate one extension (renderer / command trigger).
 * Gates: descriptor ok → enabled → craft-sandbox → host running → fresh grants.
 * Returns the commands the loaded module contributes, namespaced.
 */
export async function activateExtension(options: {
  extensionId: string
  workspaceId?: string | null
  configDir?: string
  sandboxRootEnv?: string
}): Promise<ExtensionCommandDescriptor[]> {
  const configDir = options.configDir ?? resolveConfigDir()
  const id = options.extensionId.trim()
  if (!id) throw new ExtensionActivationError('DESCRIPTOR_INVALID', 'extensionId is required')

  const descriptors = loadSandboxExtensionDescriptors({
    configDir,
    sandboxRootEnv: options.sandboxRootEnv,
  })
  const descriptor = descriptors.find((d) => d.id === id)
  if (!descriptor) {
    throw new ExtensionActivationError('DESCRIPTOR_INVALID', `unknown extension '${id}'`)
  }
  if (descriptor.status !== 'ok' || !descriptor.entryPath || !descriptor.manifest) {
    const issues = descriptor.issues?.join('; ') ?? 'invalid descriptor'
    throw new ExtensionActivationError('DESCRIPTOR_INVALID', `${id} (${issues})`)
  }

  const store = getExtensionStateStore(configDir)
  if (!store.isEnabled(id)) {
    throw new ExtensionActivationError('EXTENSION_DISABLED', id)
  }
  if (descriptor.manifest.runtime !== 'craft-sandbox') {
    throw new ExtensionActivationError(
      'EXTENSION_NOT_EXECUTABLE',
      `${id} runtime '${descriptor.manifest.runtime}'`,
    )
  }

  const declared = new Set(descriptor.manifest.permissions)
  const operations = descriptor.manifest.operations ?? {}
  for (const [method, permissions] of Object.entries(operations)) {
    if (permissions.some((permission) => !declared.has(permission))) {
      throw new ExtensionActivationError(
        'DESCRIPTOR_INVALID',
        `operation '${method}' requires a capability absent from the manifest`,
      )
    }
  }

  const manager = getExtensionHostManager(options.workspaceId)
  const status = await manager.start()
  if (status.status !== 'running') {
    throw new ExtensionActivationError(
      'HOST_UNAVAILABLE',
      status.message ?? 'Extension Host is not running',
    )
  }

  const grants = resolveExtensionGrantsFromPermissions(options.workspaceId, id)
  try {
    await manager.loadExtension(id, descriptor.entryPath, grants, operations)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (HOST_FAILURE_RE.test(message)) {
      throw new ExtensionActivationError('HOST_UNAVAILABLE', message)
    }
    throw err
  }

  const commands = await manager.listExtensionCommands(id)
  return commands.map((command) => ({
    ...command,
    id: extensionCommandId(id, command.id),
  }))
}