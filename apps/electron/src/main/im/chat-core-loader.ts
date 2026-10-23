/**
 * Native `@rox/chat-core` loader (deliverable 4).
 *
 * The module is resolved lazily through a non-literal dynamic `import()` so the
 * bundler/type-checker never hard-fails when the package is absent, and so the
 * require/import failure is catchable at runtime. Every failure mode — module
 * missing, `ChatCoreUnavailableError` (native binding absent), a factory that
 * throws during `start()` — resolves to `{ status: 'unavailable' }` instead of
 * throwing, so callers fall back to the JSON team-chat store.
 */

import type {
  ImChatCoreModule,
  ImChatCoreOptions,
  ImLoadResult,
  ImModuleLoader,
} from './types'

/** Bare specifier of the optional native package (typed `string`, not a literal). */
export const CHAT_CORE_MODULE_ID = '@rox/chat-core' as string

/** True for the frozen package's typed "native binding missing" error. */
export function isChatCoreUnavailableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return 'name' in error && error.name === 'ChatCoreUnavailableError'
}

/** Default loader: a runtime-resolved dynamic import (never statically bundled). */
async function defaultLoadModule(): Promise<unknown> {
  const specifier: string = CHAT_CORE_MODULE_ID
  return import(specifier)
}

/** Read `createChatCore` off an untyped module namespace, narrowing at the boundary. */
function readFactory(moduleExports: unknown): ImChatCoreModule['createChatCore'] | null {
  if (typeof moduleExports !== 'object' || moduleExports === null) return null
  if (!('createChatCore' in moduleExports)) return null
  const candidate = moduleExports.createChatCore
  if (typeof candidate !== 'function') return null
  // Narrowed to a callable; the frozen package guarantees this signature.
  const factory: ImChatCoreModule['createChatCore'] = candidate as ImChatCoreModule['createChatCore']
  return factory
}

export interface LoadImChatCoreInput {
  /** Effective `workbench.mode.messenger.v1` state. */
  enabled: boolean
  /** Constructor options, or `null` when the relay is not configured on this host. */
  options: ImChatCoreOptions | null
  /** Test seam; defaults to a real dynamic import. */
  load?: ImModuleLoader
}

/**
 * Load and start the native client, or report why it is unavailable. Never
 * throws: the returned reason is the honest fallback signal.
 */
export async function loadImChatCore(input: LoadImChatCoreInput): Promise<ImLoadResult> {
  const load = input.load ?? defaultLoadModule
  if (!input.enabled) return { status: 'unavailable', reason: 'flag-disabled' }
  if (!input.options) return { status: 'unavailable', reason: 'not-configured' }

  let moduleExports: unknown
  try {
    moduleExports = await load()
  } catch (error) {
    return {
      status: 'unavailable',
      reason: isChatCoreUnavailableError(error) ? 'native-unavailable' : 'module-missing',
    }
  }

  const factory = readFactory(moduleExports)
  if (!factory) return { status: 'unavailable', reason: 'module-missing' }

  try {
    const client = factory(input.options)
    await client.start()
    return { status: 'ready', client }
  } catch (error) {
    return {
      status: 'unavailable',
      reason: isChatCoreUnavailableError(error) ? 'native-unavailable' : 'start-failed',
    }
  }
}
