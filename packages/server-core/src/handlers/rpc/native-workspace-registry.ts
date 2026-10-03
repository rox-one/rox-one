import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { resolveConfigDir } from '@craft-agent/shared/config'
import { expandPath } from '@craft-agent/shared/utils/paths'

/** Bounded regular JSON file read without migrations, recovery or symlink traversal. */
export function readNativeConfigurationFile(path: string): Record<string, unknown> | null {
  let descriptor: number | undefined
  try {
    const expected = lstatSync(path)
    if (!expected.isFile() || expected.isSymbolicLink() || expected.size > 1024 * 1024) return null
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const actual = fstatSync(descriptor)
    if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino || actual.size > 1024 * 1024) return null
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
  finally { if (descriptor !== undefined) closeSync(descriptor) }
}

export function readNativeConfigurationRegistry(): Record<string, unknown> | null {
  return readNativeConfigurationFile(join(resolveConfigDir(), 'config.json'))
}

/** Canonical lookup without local registry recovery, folder binding or migrations. */
export function readNativeWorkspaceRegistry(workspaceId: string): { id: string; rootPath: string } | null {
  const workspace = readNativeWorkspaceMetadata(workspaceId)
  return workspace ? { id: workspace.id, rootPath: workspace.rootPath } : null
}

export function readNativeWorkspaceMetadata(workspaceId: string): {
  id: string; rootPath: string; name: string; slug?: string; createdAt: number; kind: 'personal' | 'team'; orgId?: string
} | null {
  if (typeof workspaceId !== 'string' || !workspaceId) return null
  try {
    const registry = readNativeConfigurationRegistry()
    if (!registry || !Array.isArray(registry.workspaces)) return null
    const record = registry.workspaces.find((workspace: unknown) => workspace && typeof workspace === 'object' && 'id' in workspace && workspace.id === workspaceId)
    if (!record || typeof record.rootPath !== 'string') return null
    const rootPath = expandPath(record.rootPath)
    if (!isAbsolute(rootPath)) return null
    const bounded = (value: unknown, max: number): string | undefined => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, max) : undefined
    return {
      id: workspaceId, rootPath, name: bounded(record.name, 200) ?? workspaceId,
      slug: bounded(record.slug, 128), createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
      kind: record.kind === 'team' ? 'team' : 'personal', orgId: record.kind === 'team' ? bounded(record.orgId, 128) : undefined,
    }
  } catch { return null }
}
