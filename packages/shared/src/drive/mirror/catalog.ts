/**
 * ROX Drive (R13 mirror) — catalog scan of the app-config directory.
 *
 * Walks `<configDir>` once and returns every file a slice policy selects. The
 * default policies mirror exactly the slices R13 claims to cover and leave the
 * rest as an honest gap (`include: false`), rather than inventing coverage:
 *
 *  - settings   `<configDir>/config.json`, `preferences.json`, `theme.json`, `themes/**`
 *  - workspaces `workspaces/<id>/{config,permissions}.json`, `skills/**`, `sources/**`, `pages/**`
 *  - sessions   `workspaces/<id>/sessions/<sid>/**`
 *  - keeper     `keeper/**` minus `*.key.enc` (see below)
 *  - drive/** `meetings/**` `clipboard/**` — not included yet
 *
 * Files larger than a slice's `maxFileBytes` are left out (with one warning per
 * file — never silently), and only files at or below the limit are hashed.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DriveMirrorSliceId,
  MirrorCatalogFs,
  MirrorCatalogOptions,
  MirrorSlicePolicy,
  MirrorSourceEntry,
} from './types'

/** Default per-file hash/upload ceiling for a slice. */
export const MIRROR_DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024

/** Directory names never traversed, at any depth. */
const SKIP_DIR_NAMES: Record<string, true> = { node_modules: true, tmp: true }

/** File names never mirrored. */
const SKIP_FILE_NAMES: Record<string, true> = { '.DS_Store': true }

/** File suffixes never mirrored (live writer locks). */
const SKIP_FILE_SUFFIXES = ['.lock'] as const

/**
 * Mandatory exclusions applied regardless of slice policy.
 *
 * `*.key.enc` is the Keeper vault key wrapped by Electron `safeStorage`; it is
 * device-bound, so the ciphertext is useless on another device and mirroring it
 * would only spread an unusable secret. Escalation to the vault owner instead
 * of syncing the key. The vault body (`vault.json`) is already AES-256-GCM
 * ciphertext and is mirrored normally.
 */
const MANDATORY_EXCLUDED_SUFFIXES = ['.key.enc'] as const

export const DEFAULT_MIRROR_SLICE_POLICIES: readonly MirrorSlicePolicy[] = [
  {
    sliceId: 'settings',
    include: true,
    patterns: ['config.json', 'preferences.json', 'theme.json', 'themes/**'],
    maxFileBytes: MIRROR_DEFAULT_MAX_FILE_BYTES,
  },
  {
    sliceId: 'workspaces',
    include: true,
    patterns: [
      'workspaces/*/config.json',
      'workspaces/*/permissions.json',
      'workspaces/*/skills/**',
      'workspaces/*/sources/**',
      'workspaces/*/pages/**',
    ],
    maxFileBytes: MIRROR_DEFAULT_MAX_FILE_BYTES,
  },
  {
    sliceId: 'sessions',
    include: true,
    patterns: ['workspaces/*/sessions/**'],
    maxFileBytes: MIRROR_DEFAULT_MAX_FILE_BYTES,
  },
  {
    sliceId: 'keeper',
    include: true,
    patterns: ['keeper/**'],
    maxFileBytes: MIRROR_DEFAULT_MAX_FILE_BYTES,
  },
  // Honest gap: these slices are not mirrored yet, so they are excluded by
  // policy rather than approximated by a narrower pattern.
  { sliceId: 'drive', include: false, patterns: ['drive/**'], maxFileBytes: MIRROR_DEFAULT_MAX_FILE_BYTES },
  { sliceId: 'meetings', include: false, patterns: ['meetings/**'], maxFileBytes: MIRROR_DEFAULT_MAX_FILE_BYTES },
  { sliceId: 'clipboard', include: false, patterns: ['clipboard/**'], maxFileBytes: MIRROR_DEFAULT_MAX_FILE_BYTES },
]

/** Node `fs/promises` implementation of the catalog seam. */
export const nodeMirrorCatalogFs: MirrorCatalogFs = {
  async readdir(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: () => entry.isDirectory(),
      isFile: () => entry.isFile(),
    }))
  },
  async stat(path) {
    const info = await stat(path)
    return { size: info.size, mtimeMs: info.mtimeMs }
  },
  readFile: path => readFile(path),
}

/**
 * Translate a slice glob into a matcher. Supports `**` (any path segments,
 * including none), `*`/`?` (within one segment) and literal text; everything
 * else is treated literally.
 */
function compileGlob(pattern: string): RegExp {
  const segments = pattern.split('/')
  let source = '^'
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? ''
    const last = index === segments.length - 1
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*'
      continue
    }
    const literal = segment
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
    source += literal
    if (!last) source += '/'
  }
  return new RegExp(`${source}$`)
}

/**
 * First policy (in declaration order) that includes `relativePath`, or null.
 * `include: false` policies never select a file.
 */
function selectPolicy(
  relativePath: string,
  policies: readonly MirrorSlicePolicy[],
  compiled: ReadonlyMap<DriveMirrorSliceId, readonly RegExp[]>,
): MirrorSlicePolicy | null {
  for (const policy of policies) {
    if (!policy.include) continue
    const matchers = compiled.get(policy.sliceId) ?? []
    if (matchers.some(matcher => matcher.test(relativePath))) return policy
  }
  return null
}

export async function scanMirrorCatalog(options: MirrorCatalogOptions): Promise<MirrorSourceEntry[]> {
  const { configDir } = options
  const policies = options.policies ?? DEFAULT_MIRROR_SLICE_POLICIES
  const fs = options.fs ?? nodeMirrorCatalogFs
  const compiled = new Map<DriveMirrorSliceId, readonly RegExp[]>()
  for (const policy of policies) {
    compiled.set(policy.sliceId, policy.patterns.map(compileGlob))
  }

  const found = new Map<string, MirrorSourceEntry>()

  async function visit(absoluteDir: string, relativeDir: string): Promise<void> {
    const dirents = await fs.readdir(absoluteDir)
    for (const dirent of dirents) {
      const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name
      const absolutePath = join(absoluteDir, dirent.name)

      if (dirent.isDirectory()) {
        if (SKIP_DIR_NAMES[dirent.name] === true) continue
        await visit(absolutePath, relativePath)
        continue
      }
      if (!dirent.isFile()) continue
      if (SKIP_FILE_NAMES[dirent.name] === true) continue
      if (SKIP_FILE_SUFFIXES.some(suffix => dirent.name.endsWith(suffix))) continue
      if (MANDATORY_EXCLUDED_SUFFIXES.some(suffix => relativePath.endsWith(suffix))) continue

      const policy = selectPolicy(relativePath, policies, compiled)
      if (!policy) continue

      const info = await fs.stat(absolutePath)
      if (info.size > policy.maxFileBytes) {
        console.warn(
          `[drive-mirror] skipping oversized file (${info.size} > ${policy.maxFileBytes} bytes): ${relativePath}`,
        )
        continue
      }
      // Dedup key is the relative path; a later duplicate is ignored.
      if (found.has(relativePath)) continue
      const bytes = await fs.readFile(absolutePath)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      found.set(relativePath, {
        sliceId: policy.sliceId,
        relativePath,
        absPath: absolutePath,
        sizeBytes: info.size,
        mtimeMs: info.mtimeMs,
        sha256,
      })
    }
  }

  await visit(configDir, '')
  return [...found.values()].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
}