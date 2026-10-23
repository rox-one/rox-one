/**
 * Registers the cognee GraphMemoryProvider with MemoryIndexService.
 * Safe to call once at process start; no-op when the sidecar package is missing.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { getBundledAssetsDir } from '@rox/shared/utils/paths'
import { setGraphMemoryProviderResolver } from '../MemoryIndexService'
import { createCogneeProviderResolver } from './cognee-node'

export function resolveCogneeSidecarSourceDir(explicit?: string): string | null {
  if (explicit !== undefined) {
    if (!explicit || !existsSync(join(explicit, 'pyproject.toml'))) return null
    return explicit
  }
  const bundled = getBundledAssetsDir('cognee-sidecar')
  if (bundled && existsSync(join(bundled, 'pyproject.toml'))) return bundled
  const candidates = [
    join(process.cwd(), 'packages', 'cognee-sidecar'),
    join(process.cwd(), '..', 'packages', 'cognee-sidecar'),
    join(process.cwd(), '..', '..', 'packages', 'cognee-sidecar'),
    join(process.cwd(), 'resources', 'cognee-sidecar'),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'pyproject.toml'))) return c
  }
  return null
}

export interface InstallCogneeGraphMemoryOptions {
  sidecarSourceDir?: string
  logger?: { warn: (m: string, e?: unknown) => void; info?: (m: string) => void }
  /** Master toggle; callers should pass getMemoryConfig().enabled && .graph. Default true. */
  isEnabled?: () => boolean
}

/** Wire cognee into MemoryIndexService. Returns true when a resolver was registered. */
export function installCogneeGraphMemory(opts: InstallCogneeGraphMemoryOptions = {}): boolean {
  const dir = resolveCogneeSidecarSourceDir(opts.sidecarSourceDir)
  if (!dir) {
    opts.logger?.warn('cognee graph memory: sidecar package not found; leaving resolver unset')
    return false
  }
  const isEnabled = opts.isEnabled ?? (() => true)
  const { resolver, shutdownAll } = createCogneeProviderResolver({
    sidecarSourceDir: dir,
    isEnabled,
    ...(opts.logger ? { logger: opts.logger } : {}),
  })
  setGraphMemoryProviderResolver(resolver)
  const shutdown = () => {
    try {
      shutdownAll()
    } catch {
      /* ignore */
    }
    setGraphMemoryProviderResolver(null)
  }
  // Only 'exit': SIGINT/SIGTERM listeners would override Node/Electron default terminate.
  process.once('exit', shutdown)
  opts.logger?.info?.(`cognee graph memory: resolver registered (${dir})`)
  return true
}
