/**
 * Open a workspace directory in a GUI editor found on PATH.
 *
 * Candidates (first match wins): cmux, cursor, code, zed.
 * Never launches Terminal.app / `open -a Terminal`.
 */

export const EDITOR_BINARIES = ['cmux', 'cursor', 'code', 'zed'] as const

export type EditorBinary = (typeof EDITOR_BINARIES)[number]

export interface EditorLaunchPlan {
  command: string
  args: string[]
  cwd: string
  editor: EditorBinary
}

export type EditorLaunchResult =
  | { ok: true; plan: EditorLaunchPlan }
  | { ok: false; reason: 'empty-cwd' | 'no-editor' | 'forbidden' }

export interface EditorLookupOptions {
  pathEnv: string
  extraDirs?: string[]
  exists: (absolutePath: string) => boolean
  pathSep?: '/' | '\\'
  delimiter?: ':' | ';'
}

export function isForbiddenEditorLaunch(command: string, args: readonly string[]): boolean {
  const joined = [command, ...args].join(' ').toLowerCase()
  if (joined.includes('terminal.app')) return true
  if (/\bopen\b/.test(joined) && /\bterminal\b/.test(joined)) return true
  const base = command.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  if (base === 'terminal' || base === 'terminal.app') return true
  if (command === 'open' && args.some((arg) => /terminal/i.test(arg))) return true
  return false
}

export function lookupBinaryOnPath(bin: string, opts: EditorLookupOptions): string | null {
  const pathSep = opts.pathSep ?? (opts.pathEnv.includes('\\') ? '\\' : '/')
  const delimiter = opts.delimiter ?? (pathSep === '\\' ? ';' : ':')
  const dirs = [...opts.pathEnv.split(delimiter), ...(opts.extraDirs ?? [])]
  const names = pathSep === '\\' ? [bin, `${bin}.cmd`, `${bin}.exe`] : [bin]
  for (const dir of dirs) {
    const trimmed = dir.trim()
    if (!trimmed) continue
    const prefix = trimmed.endsWith(pathSep) ? trimmed : `${trimmed}${pathSep}`
    for (const name of names) {
      const candidate = `${prefix}${name}`
      if (opts.exists(candidate)) return candidate
    }
  }
  return null
}

export function resolveEditorLaunch(input: {
  dirPath: string
  lookup: (bin: EditorBinary) => string | null
}): EditorLaunchResult {
  const cwd = input.dirPath.trim()
  if (!cwd) return { ok: false, reason: 'empty-cwd' }

  for (const editor of EDITOR_BINARIES) {
    const command = input.lookup(editor)
    if (!command) continue
    const plan: EditorLaunchPlan = { command, args: [cwd], cwd, editor }
    if (isForbiddenEditorLaunch(plan.command, plan.args)) continue
    return { ok: true, plan }
  }
  return { ok: false, reason: 'no-editor' }
}

export function launchWorkspaceInEditor(
  dirPath: string,
  io: {
    lookup: (bin: EditorBinary) => string | null
    spawn: (command: string, args: string[], cwd: string) => void
  },
): { opened: boolean; editor?: EditorBinary; reason?: string } {
  const resolved = resolveEditorLaunch({ dirPath, lookup: io.lookup })
  if (!resolved.ok) return { opened: false, reason: resolved.reason }
  if (isForbiddenEditorLaunch(resolved.plan.command, resolved.plan.args)) {
    return { opened: false, reason: 'forbidden' }
  }
  io.spawn(resolved.plan.command, resolved.plan.args, resolved.plan.cwd)
  return { opened: true, editor: resolved.plan.editor }
}

export const DEFAULT_EDITOR_EXTRA_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/Applications/Cursor.app/Contents/Resources/app/bin',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin',
  '/Applications/Zed.app/Contents/MacOS',
]
