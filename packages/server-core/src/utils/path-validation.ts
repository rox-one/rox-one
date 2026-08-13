import { statSync, type Stats } from 'fs'
import { dirname, win32 as pathWin32, posix as pathPosix } from 'path'

export interface PathValidationResult {
  valid: boolean
  reason?: string
}

type StatLike = (path: string) => Stats

function isAbsolutePathForPlatform(path: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
  }
  return path.startsWith('/')
}

/**
 * Validate path format for the current server platform (no filesystem access).
 * Rejects cross-platform paths (e.g., Windows paths on macOS and vice versa).
 * Platform is injectable for cross-platform unit testing without mocking globals.
 */
export function validatePathFormat(
  path: string,
  platform: NodeJS.Platform = process.platform
): PathValidationResult {
  const trimmed = path.trim()
  const isWindows = platform === 'win32'

  if (!trimmed) {
    return { valid: false, reason: 'Path is required.' }
  }

  if (!isWindows) {
    if (/^[A-Za-z]:(?:[\\/]|$)/.test(trimmed)) {
      return { valid: false, reason: 'Windows drive path is not valid on this server. Use a server-side path.' }
    }
    if (trimmed.startsWith('\\\\')) {
      return { valid: false, reason: 'UNC path is not valid on this server. Use a server-side path.' }
    }
    if (!trimmed.startsWith('/')) {
      return { valid: false, reason: 'Path must be absolute (start with /).' }
    }
    return { valid: true }
  }

  if (trimmed.startsWith('/')) {
    return { valid: false, reason: 'Unix path is not valid on this server. Use a Windows path (e.g., C:\\...).' }
  }

  if (!isAbsolutePathForPlatform(trimmed, platform)) {
    return { valid: false, reason: 'Path must be an absolute Windows path (e.g., C:\\... or \\\\server\\share\\...).' }
  }

  return { valid: true }
}

/**
 * Validate that a path is a usable working directory on the current server.
 * Checks format, existence, and that the path is a directory.
 */
export function isValidWorkingDirectory(
  path: string,
  platform: NodeJS.Platform = process.platform,
  statFn: StatLike = statSync
): PathValidationResult {
  const trimmed = path.trim()
  const formatCheck = validatePathFormat(trimmed, platform)
  if (!formatCheck.valid) return formatCheck

  try {
    const s = statFn(trimmed)
    if (!s.isDirectory()) {
      return { valid: false, reason: `Not a directory: ${trimmed}` }
    }
  } catch {
    return { valid: false, reason: `Directory not found: ${trimmed}` }
  }

  return { valid: true }
}

/**
 * Validate that a workspace root path is usable on the current server.
 * Existing directories are allowed. Non-existent paths are allowed only when
 * their parent directory exists, which supports "create new workspace" flows.
 */
export function isValidWorkspaceRootPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
  statFn: StatLike = statSync
): PathValidationResult {
  const trimmed = path.trim()
  const formatCheck = validatePathFormat(trimmed, platform)
  if (!formatCheck.valid) return formatCheck

  try {
    const existing = statFn(trimmed)
    if (!existing.isDirectory()) {
      return { valid: false, reason: `Not a directory: ${trimmed}` }
    }
    return { valid: true }
  } catch {
    let currentPath = trimmed

    while (true) {
      const parentPath = platform === 'win32' ? pathWin32.dirname(currentPath) : dirname(currentPath)

      if (!parentPath || parentPath === currentPath) {
        return { valid: false, reason: `Parent directory not found: ${currentPath}` }
      }

      try {
        const parent = statFn(parentPath)
        if (!parent.isDirectory()) {
          return { valid: false, reason: `Parent path is not a directory: ${parentPath}` }
        }
        return { valid: true }
      } catch {
        currentPath = parentPath
      }
    }
  }
}

function resolveForPlatform(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? pathWin32.resolve(path) : pathPosix.resolve(path)
}

export function isPathInsideBase(
  candidate: string,
  base: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const resolvedBase = resolveForPlatform(base, platform)
  const resolvedCandidate = resolveForPlatform(candidate, platform)
  const rel = platform === 'win32'
    ? pathWin32.relative(resolvedBase, resolvedCandidate)
    : pathPosix.relative(resolvedBase, resolvedCandidate)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  return platform === 'win32' ? !pathWin32.isAbsolute(rel) : !pathPosix.isAbsolute(rel)
}

/**
 * Resolve `relativePath` against `base` and require the result to stay inside
 * `base`. Rejects absolute inputs (POSIX `/…`, Windows drive/UNC) so
 * `join(base, "/etc/passwd")` cannot ignore the base. Throws on escape.
 */
export function resolveContainedRelativePath(
  base: string,
  relativePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const trimmed = relativePath.trim()
  if (!trimmed) {
    throw new Error('Invalid path: path is required')
  }
  if (trimmed.includes('\0')) {
    throw new Error('Invalid path: directory traversal not allowed')
  }
  if (isAbsolutePathForPlatform(trimmed, platform)) {
    throw new Error('Invalid path: absolute paths are not allowed')
  }

  const resolvedBase = resolveForPlatform(base, platform)
  const resolved = resolveForPlatform(
    platform === 'win32'
      ? pathWin32.join(resolvedBase, trimmed)
      : pathPosix.join(resolvedBase, trimmed),
    platform,
  )

  if (!isPathInsideBase(resolved, resolvedBase, platform)) {
    throw new Error('Invalid path: outside workspace directory')
  }
  return resolved
}

/**
 * Notes vault paths may be customized, but must stay inside the workspace
 * (or an extra allowed root such as the default per-workspace notes dir).
 * Otherwise notes:deleteFolder can recursively destroy arbitrary directories.
 */
export function isValidNotesPath(
  notesPath: string,
  workspaceRoot: string,
  extraAllowedRoots: string[] = [],
  platform: NodeJS.Platform = process.platform,
  statFn: StatLike = statSync
): PathValidationResult {
  const working = isValidWorkingDirectory(notesPath, platform, statFn)
  if (!working.valid) return working

  const trimmed = notesPath.trim()
  const allowed = [workspaceRoot, ...extraAllowedRoots]
  if (!allowed.some((root) => isPathInsideBase(trimmed, root, platform))) {
    return { valid: false, reason: 'Notes path must be inside the workspace.' }
  }
  return { valid: true }
}
