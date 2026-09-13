/**
 * cwd `$HOME` is never a Rox workspace (H-04 §4).
 * Foreign scan/persist is allowlisted to these roots — never all of $HOME.
 */

import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { ForeignSessionKind } from './import-types.ts'

export function isHomePath(target: string | undefined, home = homedir()): boolean {
  if (!target) return false
  try {
    return realOrResolve(target) === realOrResolve(home)
  } catch {
    return false
  }
}

const SENSITIVE_SEGMENTS = ['/.ssh', '/.gnupg', '/.aws', '/.kube', '/.config/gcloud']

export function isSensitiveAgentCwd(cwd: string | undefined, home = homedir()): boolean {
  if (!cwd || cwd.trim().startsWith('-')) return true
  if (isHomePath(cwd, home)) return true
  let normalized: string
  try {
    normalized = resolve(cwd)
  } catch {
    return true
  }
  if (normalized === '/' || normalized === '/etc' || normalized.startsWith(`/etc${sep}`)) return true
  const posix = normalized.replaceAll('\\', '/')
  return SENSITIVE_SEGMENTS.some((segment) => posix.includes(segment))
}

export function realOrResolve(path: string): string {
  try {
    return existsSync(path) ? realpathSync(path) : resolve(path)
  } catch {
    return resolve(path)
  }
}

export function sameRealPath(left: string, right: string): boolean {
  try {
    return realOrResolve(left) === realOrResolve(right)
  } catch {
    return false
  }
}

/** `file.json#conversationId` refs from multi-chat exports. Fragment has no slashes. */
export function splitForeignSourceRef(sourcePath: string): { path: string; fragment?: string } {
  const hash = sourcePath.lastIndexOf('#')
  if (hash <= 0) return { path: sourcePath }
  const fragment = sourcePath.slice(hash + 1)
  if (!fragment || fragment.includes('/') || fragment.includes('\\')) return { path: sourcePath }
  return { path: sourcePath.slice(0, hash), fragment }
}

export interface ForeignImportRootSpec {
  kind: ForeignSessionKind
  segments: string[]
}

export const FOREIGN_IMPORT_ROOT_SPECS: ForeignImportRootSpec[] = [
  { kind: 'grok', segments: ['.grok', 'sessions'] },
  { kind: 'claude', segments: ['.claude', 'projects'] },
  { kind: 'codex', segments: ['.codex', 'sessions'] },
  { kind: 'hermes', segments: ['.hermes'] },
  { kind: 'opencode', segments: ['.local', 'share', 'opencode'] },
  { kind: 'opencode', segments: ['.opencode'] },
  { kind: 'chatgpt', segments: ['.chatgpt'] },
  { kind: 'chatgpt', segments: ['Downloads', 'chatgpt'] },
  { kind: 'chatgpt', segments: ['Downloads', 'ChatGPT'] },
  { kind: 'deepseek', segments: ['.deepseek'] },
  { kind: 'deepseek', segments: ['Downloads', 'deepseek'] },
  { kind: 'gemini', segments: ['.gemini'] },
  { kind: 'qwen', segments: ['.qwen'] },
  { kind: 'amp', segments: ['.local', 'share', 'amp'] },
  { kind: 'amp', segments: ['.amp'] },
  { kind: 'amp', segments: ['Library', 'Application Support', 'amp'] },
  { kind: 'amp', segments: ['AppData', 'Roaming', 'amp'] },
  { kind: 'cursor', segments: ['.cursor', 'projects'] },
  { kind: 'openclaw', segments: ['.openclaw'] },
  { kind: 'omp', segments: ['.omp'] },
  { kind: 'pi', segments: ['.pi'] },
  { kind: 'kiro', segments: ['.kiro', 'projects'] },
  { kind: 'kimi', segments: ['.kimi'] },
  { kind: 'glm', segments: ['.glm'] },
  { kind: 'z', segments: ['.zai'] },
  { kind: 'z', segments: ['.zagent'] },
]

export function foreignImportRootEntries(home = homedir()): Array<{ kind: ForeignSessionKind; path: string }> {
  const root = realOrResolve(home)
  return FOREIGN_IMPORT_ROOT_SPECS.map((spec) => ({
    kind: spec.kind,
    path: join(root, ...spec.segments),
  }))
}

export function foreignImportRoots(home = homedir()): string[] {
  return foreignImportRootEntries(home).map((entry) => entry.path)
}

export function isAllowedForeignSourcePath(sourcePath: string, home = homedir()): boolean {
  if (!sourcePath || sourcePath.trim().startsWith('-')) return false
  const { path } = splitForeignSourceRef(sourcePath)
  const resolved = realOrResolve(path)
  return foreignImportRoots(home).some((root) => {
    const normalizedRoot = realOrResolve(root)
    return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${sep}`)
  })
}

export function inferKindFromAllowlistedPath(
  sourcePath: string,
  home = homedir(),
): ForeignSessionKind | undefined {
  const { path } = splitForeignSourceRef(sourcePath)
  if (!isAllowedForeignSourcePath(path, home)) return undefined
  const resolved = realOrResolve(path).replaceAll('\\', '/')
  let best: { kind: ForeignSessionKind; len: number } | undefined
  for (const entry of foreignImportRootEntries(home)) {
    const normalized = realOrResolve(entry.path).replaceAll('\\', '/')
    if (resolved === normalized || resolved.startsWith(`${normalized}/`)) {
      if (!best || normalized.length > best.len) best = { kind: entry.kind, len: normalized.length }
    }
  }
  return best?.kind
}
