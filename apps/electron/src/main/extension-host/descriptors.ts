/**
 * craft-sandbox descriptor discovery (S-05 §3.5 / wave-3 c2.5).
 *
 * Manifest-first plane: scan `{root}/*\/manifest.json` ONE level deep under the
 * sandbox roots (config root + optional `CRAFT_EXTENSION_SANDBOX_ROOT`),
 * validate each manifest fail-closed, and compute a content hash over the
 * package — WITHOUT executing any package code. `descriptors` never imports or
 * requires an entry module; only bytes are read (manifest + entry + file list).
 *
 * Guarantees:
 *   - ≤256 packages, manifest ≤256 KiB, ≤512 listed files
 *   - invalid package → `status:'invalid'` with issues; the batch continues
 *   - entry/package containment re-checked through the realpath allowlist
 *   - duplicate id across roots → first wins, later one flagged `shadowed:<dir>`
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseExtensionManifest,
  type ExtensionManifest,
  type SandboxExtensionDescriptor,
} from '@rox/shared/extensions'
import { isPathAllowlisted, resolveSandboxRoots } from './path-allowlist'

const MAX_PACKAGES = 256
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_LISTED_FILES = 512

/** Entry candidates tried after `manifest.entry` and `package.json#main`. */
const DEFAULT_ENTRY_CANDIDATES = ['index.js', 'index.mjs', 'index.cjs'] as const

export interface LoadSandboxExtensionDescriptorsOptions {
  configDir: string
  /** Overrides `CRAFT_EXTENSION_SANDBOX_ROOT` for the extra scan root. */
  sandboxRootEnv?: string
}

function listSubdirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => {
        if (entry.isDirectory()) return true
        if (!entry.isSymbolicLink()) return false
        try {
          return statSync(join(root, entry.name)).isDirectory()
        } catch {
          return false
        }
      })
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Recursive relative file list (posix separators), capped and sorted. */
function listPackageFiles(pkgDir: string): string[] {
  const files: string[] = []
  const walk = (dir: string, prefix: string): void => {
    if (files.length >= MAX_LISTED_FILES) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_LISTED_FILES) return
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel)
      } else if (entry.isFile()) {
        files.push(rel)
      }
    }
  }
  walk(pkgDir, '')
  return files.sort()
}

function readStringField(raw: unknown, key: string): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  // Parsed-JSON boundary: the value is a plain object, so read it as a string map.
  const record = raw as Record<string, unknown>
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Resolve the package entry module. `manifest.entry` wins, then
 * `package.json#main`, then the conventional index files. Every candidate is
 * re-checked against the sandbox allowlist (realpath) so a symlinked entry
 * cannot escape.
 */
function resolveEntryPath(
  pkgDir: string,
  rawManifest: unknown,
  roots: string[],
): { entryPath?: string; issue?: string } {
  const candidates: string[] = []
  const declaredEntry = readStringField(rawManifest, 'entry')
  if (declaredEntry) candidates.push(declaredEntry)

  const packageJsonPath = join(pkgDir, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const pkgJson: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      const main = readStringField(pkgJson, 'main')
      if (main) candidates.push(main)
    } catch {
      // unparsable package.json → fall through to defaults
    }
  }
  candidates.push(...DEFAULT_ENTRY_CANDIDATES)

  for (const candidate of candidates) {
    const candidatePath = join(pkgDir, candidate)
    if (!existsSync(candidatePath)) continue
    const contained = isPathAllowlisted(candidatePath, roots)
    if (!contained.ok) {
      return { issue: `entryPath-rejected: ${contained.reason}` }
    }
    return { entryPath: contained.resolved }
  }
  return { issue: 'missingEntry' }
}

function invalidDescriptor(
  id: string,
  dir: string,
  issues: string[],
  runtime?: ExtensionManifest['runtime'],
): SandboxExtensionDescriptor {
  return { id, dir, status: 'invalid', issues, ...(runtime ? { runtime } : {}) }
}

export function loadSandboxExtensionDescriptors(
  options: LoadSandboxExtensionDescriptorsOptions,
): SandboxExtensionDescriptor[] {
  const roots = resolveSandboxRoots({
    configDir: options.configDir,
    sandboxRootEnv: options.sandboxRootEnv,
  })
  /** id → package dir of the first descriptor that claimed it. */
  const claimed = new Map<string, string>()
  const descriptors: SandboxExtensionDescriptor[] = []
  let packages = 0

  for (const root of roots) {
    for (const name of listSubdirectories(root)) {
      if (packages >= MAX_PACKAGES) break
      packages += 1
      const pkgDir = join(root, name)

      const contained = isPathAllowlisted(pkgDir, roots)
      if (!contained.ok) {
        descriptors.push(
          invalidDescriptor(name, pkgDir, [`package-outside-sandbox: ${contained.reason}`]),
        )
        continue
      }

      const manifestPath = join(pkgDir, 'manifest.json')
      if (!existsSync(manifestPath)) {
        descriptors.push(invalidDescriptor(name, pkgDir, ['missing-manifest']))
        continue
      }
      try {
        if (statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
          descriptors.push(invalidDescriptor(name, pkgDir, ['manifest-too-large']))
          continue
        }
      } catch {
        descriptors.push(invalidDescriptor(name, pkgDir, ['manifest-unreadable']))
        continue
      }

      let manifestBytes: Buffer
      let rawManifest: unknown
      try {
        manifestBytes = readFileSync(manifestPath)
        rawManifest = JSON.parse(manifestBytes.toString('utf8'))
      } catch {
        descriptors.push(invalidDescriptor(name, pkgDir, ['manifest-unparsable']))
        continue
      }

      const id = readStringField(rawManifest, 'id') ?? name
      const firstDir = claimed.get(id)
      if (firstDir) {
        descriptors.push(invalidDescriptor(id, pkgDir, [`shadowed:${firstDir}`]))
        continue
      }
      claimed.set(id, pkgDir)

      let manifest: ExtensionManifest
      try {
        manifest = parseExtensionManifest(rawManifest)
      } catch (err) {
        const issues =
          err && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)
            ? err.issues.map((issue) => String(issue))
            : [err instanceof Error ? err.message : String(err)]
        descriptors.push(invalidDescriptor(id, pkgDir, issues))
        continue
      }

      const resolvedEntry = resolveEntryPath(pkgDir, rawManifest, roots)
      if (!resolvedEntry.entryPath) {
        descriptors.push(
          invalidDescriptor(id, pkgDir, [resolvedEntry.issue ?? 'missingEntry'], manifest.runtime),
        )
        continue
      }

      const entryBytes = readFileSync(resolvedEntry.entryPath)
      const hash = createHash('sha256')
      hash.update(manifestBytes)
      hash.update('\0')
      hash.update(entryBytes)
      hash.update('\0')
      hash.update(listPackageFiles(pkgDir).join('\n'))

      descriptors.push({
        id,
        dir: pkgDir,
        entryPath: resolvedEntry.entryPath,
        manifest,
        descriptorHash: hash.digest('hex'),
        status: 'ok',
        runtime: manifest.runtime,
      })
    }
  }

  return descriptors.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
}