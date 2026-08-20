/**
 * Knowledge hosting facade (H1 vs H3 probe).
 *
 * H3 remains legally blocked from merging kernel source. This module only
 * probes whether an opt-in env flag is set AND a native addon file exists.
 * It must never require/import the addon — loading is a future ADR.
 */

import { existsSync as fsExistsSync } from 'node:fs'
import { join } from 'node:path'

export type KnowledgeHostingMode = 'h1' | 'h3'

const ADDON_RELATIVE = join('oem-kernel', 'knowledge-engine.node')

export const DEFAULT_NATIVE_ADDON_RELATIVE = ADDON_RELATIVE

export interface ResolveKnowledgeHostingInput {
  env?: NodeJS.ProcessEnv
  existsSync?: (path: string) => boolean
  nativeAddonPath?: string
  /** Electron extraResources / process.resourcesPath when present. */
  resourcesPath?: string
  cwd?: string
}

function truthyH3Flag(value: string | undefined): boolean {
  if (value == null) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true'
}

function defaultNativeAddonPath(input: ResolveKnowledgeHostingInput): string {
  const resources =
    input.resourcesPath ??
    (typeof process === 'object' && process && 'resourcesPath' in process
      ? String((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '')
      : '')
  const root = resources || input.cwd || process.cwd()
  return join(root, ADDON_RELATIVE)
}

/**
 * Returns `'h3'` only when `ROX_KNOWLEDGE_H3` is `1`/`true` and the native
 * addon path exists on disk. Otherwise `'h1'`. Never loads the addon.
 */
export function resolveKnowledgeHosting(
  input: ResolveKnowledgeHostingInput = {},
): KnowledgeHostingMode {
  const env = input.env ?? process.env
  if (!truthyH3Flag(env.ROX_KNOWLEDGE_H3)) return 'h1'

  const addonPath = input.nativeAddonPath ?? defaultNativeAddonPath(input)
  const exists = input.existsSync ?? fsExistsSync
  if (!exists(addonPath)) return 'h1'
  return 'h3'
}
