/**
 * Idempotency index: sourcePath → Rox sessionId.
 * Lives in the workspace (.rox), never a DSH store.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sameRealPath } from './import-home.ts'
import type { ForeignIndexEntry, ForeignRegistryRecord } from './import-types.ts'

export function foreignImportRegistryPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.rox', 'foreign-import-registry.json')
}

export function foreignImportScanCachePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.rox', 'foreign-import-scan.json')
}

function emptyRegistry(): Record<string, ForeignRegistryRecord> {
  return {}
}

export function loadForeignImportRegistry(workspaceRoot: string): Record<string, ForeignRegistryRecord> {
  const path = foreignImportRegistryPath(workspaceRoot)
  if (!existsSync(path)) return emptyRegistry()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries?: Record<string, ForeignRegistryRecord> }
    return raw.entries && typeof raw.entries === 'object' ? raw.entries : emptyRegistry()
  } catch {
    return emptyRegistry()
  }
}

export function saveForeignImportRegistry(
  workspaceRoot: string,
  entries: Record<string, ForeignRegistryRecord>,
): void {
  const path = foreignImportRegistryPath(workspaceRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`)
}

export function lookupImportedSession(
  workspaceRoot: string,
  sourcePath: string,
): ForeignRegistryRecord | undefined {
  return loadForeignImportRegistry(workspaceRoot)[sourcePath]
}

export function recordImportedSession(workspaceRoot: string, record: ForeignRegistryRecord): void {
  const entries = loadForeignImportRegistry(workspaceRoot)
  entries[record.sourcePath] = record
  saveForeignImportRegistry(workspaceRoot, entries)
}

export function loadForeignImportScanCache(workspaceRoot: string): ForeignIndexEntry[] {
  const path = foreignImportScanCachePath(workspaceRoot)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries?: ForeignIndexEntry[] }
    return Array.isArray(raw.entries) ? raw.entries : []
  } catch {
    return []
  }
}

export function findScannedForeignSource(
  workspaceRoot: string,
  sourcePath: string,
): ForeignIndexEntry | undefined {
  return loadForeignImportScanCache(workspaceRoot).find(
    (entry) => entry.sourcePath === sourcePath || sameRealPath(entry.sourcePath, sourcePath),
  )
}
