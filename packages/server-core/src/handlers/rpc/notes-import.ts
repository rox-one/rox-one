/**
 * Notes import RPC handlers (RX-TSK-0411, RX-DOC-0029 FR-4/FR-6).
 *
 * LOCAL_ONLY by routing: both channels require the local filesystem and are
 * never proxied to remote servers. Preview returns the bounded scan; execute
 * materializes consented copies into the workspace data folder with a
 * provenance manifest. Indexing/agent-context changes are downstream (FR-7)
 * and intentionally out of scope here.
 */

import { CodedError, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '../../transport/types'
import { scanSourceFolder, materializeImport, NotesImportError } from '../../knowledge/notes-import'
import { join } from 'node:path'

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/

function invalidRequest(): never {
  throw new CodedError('INVALID_REF', 'Invalid notes import request')
}

function parseInput(value: unknown): { workspaceId: string; sourcePath: string } {
  if (
    typeof value !== 'object' || value === null ||
    typeof (value as { workspaceId?: unknown }).workspaceId !== 'string' ||
    !WORKSPACE_ID_PATTERN.test((value as { workspaceId: string }).workspaceId) ||
    typeof (value as { sourcePath?: unknown }).sourcePath !== 'string' ||
    (value as { sourcePath: string }).sourcePath.length === 0 ||
    (value as { sourcePath: string }).sourcePath.length > 1024
  ) {
    invalidRequest()
  }
  return value as { workspaceId: string; sourcePath: string }
}

function requireWorkspaceRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new CodedError('NOT_FOUND', `Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

/** Imports land in the workspace's own data folder, isolated per workspace. */
function importsDataRoot(workspaceRoot: string, workspaceId: string): string {
  return join(workspaceRoot, '.craft-agent', 'workspaces', workspaceId, 'notes-imports')
}

function toPublicError(err: unknown): never {
  if (err instanceof NotesImportError) {
    throw new CodedError('INVALID_REF', err.message)
  }
  throw new CodedError('PROVIDER_ERROR', 'Notes import operation failed')
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.notesImport.PREVIEW,
  RPC_CHANNELS.notesImport.EXECUTE,
] as const

export function registerNotesImportHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.notesImport.PREVIEW, async (_context, rawInput: unknown) => {
    const { sourcePath } = parseInput(rawInput)
    try {
      return scanSourceFolder(sourcePath)
    } catch (err) {
      toPublicError(err)
    }
  })

  server.handle(RPC_CHANNELS.notesImport.EXECUTE, async (_context, rawInput: unknown) => {
    const { workspaceId, sourcePath } = parseInput(rawInput)
    const workspaceRoot = requireWorkspaceRoot(workspaceId)
    try {
      const scan = scanSourceFolder(sourcePath)
      const folderName = scan.root.split('/').pop() ?? scan.root.split('\\').pop() ?? 'import'
      return materializeImport(
        importsDataRoot(workspaceRoot, workspaceId),
        folderName,
        scan,
      )
    } catch (err) {
      toPublicError(err)
    }
  })
}
