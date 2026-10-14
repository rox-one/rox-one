/**
 * Cloud handoff import («В облако»): on a headless server started by
 * `rox-handoff-start`, register the unpacked workspace (ROX_HANDOFF_WORKSPACE_DIR)
 * and make the transferred chat its active session.
 *
 * Layout written by the start script:
 *   <ws>/sessions/<ROX_HANDOFF_SESSION_ID>/session.jsonl (+ attachments, plans, …)
 *   <ws>/project/**   — referenced workspace files
 *
 * Idempotent: re-running (sandbox restart after auto-stop) re-activates the same
 * workspace and never rewrites the transcript twice.
 */
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

export const HANDOFF_WORKSPACE_DIR_ENV = 'ROX_HANDOFF_WORKSPACE_DIR'
export const HANDOFF_SESSION_ID_ENV = 'ROX_HANDOFF_SESSION_ID'
export const HANDOFF_ALLOWED_ROOT_ENV = 'ROX_HANDOFF_ALLOWED_ROOT'
const DEFAULT_ALLOWED_ROOT = '/home/daytona'
const IMPORT_MARKER = '.rox-handoff-imported'
const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/
/** Header fields that must not survive into the cloud copy (desktop-only capabilities). */
const STRIPPED_HEADER_FIELDS = ['sharedOwnerKey', 'sharedUrl', 'sharedId'] as const

export interface HandoffImportDeps {
  createAndActivateLocalWorkspace: (input: { name: string; rootPath: string }) => Promise<{
    workspace: { id: string; rootPath: string }
    session: { id: string }
  }>
  logger?: { info: (msg: string) => void; warn: (msg: string) => void }
}

export interface HandoffImportResult {
  workspaceId: string
  rootPath: string
  sessionId: string
  rewritten: boolean
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function assertRealDir(path: string, what: string): void {
  const st = lstatSync(path)
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`[cloud-handoff] ${what} must be a real directory`)
}

/**
 * Rewrite the transcript header for the cloud copy: point the working directory
 * at <ws>/project and drop desktop-only share capabilities. Atomic write.
 */
export function rewriteHandoffSessionHeader(sessionFile: string, projectDir: string): void {
  const content = readFileSync(sessionFile, 'utf8')
  const newline = content.indexOf('\n')
  const first = newline === -1 ? content : content.slice(0, newline)
  const rest = newline === -1 ? '' : content.slice(newline)
  let header: Record<string, unknown>
  try {
    header = JSON.parse(first) as Record<string, unknown>
  } catch {
    throw new Error('[cloud-handoff] session.jsonl header is not valid JSON')
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    throw new Error('[cloud-handoff] session.jsonl header is not an object')
  }
  for (const field of STRIPPED_HEADER_FIELDS) delete header[field]
  header.workingDirectory = projectDir
  const tmp = `${sessionFile}.handoff-tmp`
  writeFileSync(tmp, JSON.stringify(header) + rest, { mode: 0o600 })
  renameSync(tmp, sessionFile)
}

export async function importCloudHandoffWorkspace(
  deps: HandoffImportDeps,
  env: Record<string, string | undefined> = process.env,
): Promise<HandoffImportResult | null> {
  const rawDir = env[HANDOFF_WORKSPACE_DIR_ENV]?.trim()
  if (!rawDir) return null

  const sessionId = env[HANDOFF_SESSION_ID_ENV]?.trim() ?? ''
  if (!SESSION_ID_RE.test(sessionId) || sessionId === '.' || sessionId === '..') {
    throw new Error(`[cloud-handoff] invalid ${HANDOFF_SESSION_ID_ENV}`)
  }
  if (!isAbsolute(rawDir)) throw new Error(`[cloud-handoff] ${HANDOFF_WORKSPACE_DIR_ENV} must be absolute`)
  const allowedRoot = realpathSync(env[HANDOFF_ALLOWED_ROOT_ENV]?.trim() || DEFAULT_ALLOWED_ROOT)

  assertRealDir(rawDir, 'workspace dir')
  const rootPath = realpathSync(rawDir)
  if (!contained(allowedRoot, rootPath)) {
    throw new Error(`[cloud-handoff] workspace dir must live under ${allowedRoot}`)
  }
  const sessionsDir = join(rootPath, 'sessions')
  const sessionDir = join(sessionsDir, sessionId)
  assertRealDir(sessionsDir, 'sessions dir')
  assertRealDir(sessionDir, 'session dir')
  const sessionFile = join(sessionDir, 'session.jsonl')
  const sessionStat = lstatSync(sessionFile)
  if (!sessionStat.isFile()) throw new Error('[cloud-handoff] session.jsonl must be a regular file')
  const projectDir = join(rootPath, 'project')
  if (existsSync(projectDir)) assertRealDir(projectDir, 'project dir')

  const marker = join(rootPath, IMPORT_MARKER)
  const alreadyImported = existsSync(marker) && readFileSync(marker, 'utf8').trim() === sessionId
  if (!alreadyImported) {
    rewriteHandoffSessionHeader(sessionFile, projectDir)
    writeFileSync(marker, `${sessionId}\n`, { mode: 0o600 })
  }

  // Registers the root once (lookup by rootPath) and activates its latest
  // session — the transferred chat is the only one in a fresh sandbox.
  const activation = await deps.createAndActivateLocalWorkspace({ name: 'Облачная сессия', rootPath })
  if (activation.session.id !== sessionId) {
    deps.logger?.warn(`[cloud-handoff] active session ${activation.session.id} differs from transferred ${sessionId}`)
  }
  deps.logger?.info(`[cloud-handoff] imported session ${sessionId} into workspace ${activation.workspace.id}`)
  return { workspaceId: activation.workspace.id, rootPath, sessionId, rewritten: !alreadyImported }
}
