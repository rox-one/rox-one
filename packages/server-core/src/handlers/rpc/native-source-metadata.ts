import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CodedError } from '@craft-agent/shared/protocol'
import { applyBuiltinSourceAvailability, getBuiltinSources, type FolderSourceConfig, type LoadedSource } from '@craft-agent/shared/sources'
import { isEmoji } from '@craft-agent/shared/utils/icon-constants'
import { readNativeConfigurationFile } from './native-workspace-registry'

const denied = (): never => { throw new CodedError('FORBIDDEN', 'Source metadata unavailable') }
const missing = (error: unknown): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
const text = (value: unknown, max: number): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, max) : ''
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)

/** Display metadata only. Native reads neither seed folders nor load guides, icons or credentials. */
export function readNativeSourceMetadata(workspaceId: string, rootPath: string): LoadedSource[] {
  const directory = join(rootPath, 'sources')
  let directoryIdentity: ReturnType<typeof lstatSync> | undefined
  try {
    directoryIdentity = lstatSync(directory)
    if (!directoryIdentity.isDirectory() || directoryIdentity.isSymbolicLink()) denied()
  } catch (error) { if (!missing(error)) throw error }
  const sources: LoadedSource[] = []
  if (directoryIdentity) {
    const entries = readdirSync(directory, { withFileTypes: true })
    if (entries.length > 1000) denied()
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) denied()
      if (!entry.isDirectory() || !identifier(entry.name)) continue
      const folder = join(directory, entry.name), identity = lstatSync(folder)
      if (!identity.isDirectory() || identity.isSymbolicLink()) denied()
      const path = join(folder, 'config.json')
      let configIdentity: ReturnType<typeof lstatSync>
      try { configIdentity = lstatSync(path) } catch (error) { if (missing(error)) continue; throw error }
      if (!configIdentity.isFile() || configIdentity.isSymbolicLink()) denied()
      const raw = readNativeConfigurationFile(path)
      if (!raw || !identifier(raw.id) || raw.slug !== entry.name || !['api', 'mcp', 'local'].includes(String(raw.type))) denied()
      const currentFolder = lstatSync(folder)
      if (currentFolder.isSymbolicLink() || currentFolder.dev !== identity.dev || currentFolder.ino !== identity.ino) denied()
      const config = applyBuiltinSourceAvailability(raw as unknown as FolderSourceConfig)
      sources.push(project(config, workspaceId))
    }
    const current = lstatSync(directory)
    if (current.isSymbolicLink() || current.dev !== directoryIdentity.dev || current.ino !== directoryIdentity.ino) denied()
  }
  // Definitions exist for every native user before any workspace folder is seeded.
  // Availability uses the existing backend-only, read-only central key resolver.
  const present = new Set(sources.map(source => source.config.slug))
  for (const builtin of getBuiltinSources(workspaceId, rootPath)) {
    if (!present.has(builtin.config.slug)) sources.push({ ...project(builtin.config, workspaceId), isBuiltin: true })
  }
  return sources
}

function project(config: FolderSourceConfig, workspaceId: string): LoadedSource {
  return {
    workspaceId, workspaceRootPath: '', folderPath: '', guide: null,
    config: {
      id: text(config.id, 128), slug: text(config.slug, 128), name: text(config.name, 200),
      type: config.type, provider: text(config.provider, 128), enabled: config.enabled === true,
      icon: typeof config.icon === 'string' && config.icon.length <= 32 && isEmoji(config.icon) ? config.icon : undefined,
      tagline: typeof config.tagline === 'string' ? text(config.tagline, 500) : undefined,
      isAuthenticated: typeof config.isAuthenticated === 'boolean' ? config.isAuthenticated : undefined,
      connectionStatus: ['connected', 'needs_auth', 'failed', 'untested', 'local_disabled'].includes(config.connectionStatus ?? '') ? config.connectionStatus : undefined,
      lastTestedAt: typeof config.lastTestedAt === 'number' && Number.isFinite(config.lastTestedAt) ? config.lastTestedAt : undefined,
    },
  }
}
