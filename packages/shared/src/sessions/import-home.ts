/**
 * cwd `$HOME` is never a Rox workspace (H-04 §4).
 */

import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

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

export function foreignImportRoots(home = homedir()): string[] {
  const root = realOrResolve(home)
  return [
    join(root, '.grok', 'sessions'),
    join(root, '.claude', 'projects'),
    join(root, '.codex', 'sessions'),
    join(root, '.hermes'),
    join(root, '.local', 'share', 'opencode'),
    join(root, '.opencode'),
  ]
}

export function isAllowedForeignSourcePath(sourcePath: string, home = homedir()): boolean {
  if (!sourcePath || sourcePath.trim().startsWith('-')) return false
  const resolved = realOrResolve(sourcePath)
  return foreignImportRoots(home).some((root) => {
    const normalizedRoot = realOrResolve(root)
    return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${sep}`)
  })
}
