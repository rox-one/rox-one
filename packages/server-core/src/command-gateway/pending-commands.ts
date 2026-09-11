/**
 * Command Gateway phase 0 — restart-safe pending-command store
 * (RX-DOC-0032, RX-TSK-0402/0407).
 *
 * Atomic full-file rewrite (temp + rename) is intentional: the set of live
 * commands is small (tens), and decisions must survive process restarts —
 * `approved` entries are picked up by their executor after relaunch, while
 * expired ones are swept on load.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const DEFAULT_COMMAND_TTL_MS = 10 * 60 * 1000

export type PendingCommandStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface PendingCommand {
  id: string
  workspaceId: string
  source: 'task-runner' | 'messaging' | 'session'
  appName: string
  command: string
  reason: string
  impact?: string
  requiresSystemPrompt?: boolean
  createdAt: number
  expiresAt: number
  status: PendingCommandStatus
  decidedBy?: string
  decidedAt?: number
}

export interface CreatePendingCommandInput {
  workspaceId: string
  source: PendingCommand['source']
  appName: string
  command: string
  reason: string
  impact?: string
  requiresSystemPrompt?: boolean
  ttlMs?: number
}

interface StoreFile {
  version: 1
  commands: PendingCommand[]
}

/** Pure decision helper exported for tests. */
export function sweepExpired(
  commands: PendingCommand[],
  now: number,
): { kept: PendingCommand[]; expiredCount: number } {
  let expiredCount = 0
  const kept = commands.map((c) => {
    if (c.status === 'pending' && c.expiresAt < now) {
      expiredCount += 1
      return { ...c, status: 'expired' as const, decidedBy: 'auto-expiry', decidedAt: now }
    }
    return c
  })
  return { kept, expiredCount }
}

/** Terminal entries (approved/denied/expired) older than this are pruned. */
export const COMMAND_RETENTION_MS = 24 * 60 * 60 * 1000

/** Pure prune helper: drops terminal decisions past the retention window. */
export function pruneTerminal(
  commands: PendingCommand[],
  now: number,
  retentionMs: number = COMMAND_RETENTION_MS,
): { kept: PendingCommand[]; prunedCount: number } {
  const kept = commands.filter((c) => {
    if (c.status === 'pending') return true
    const decidedAt = c.decidedAt ?? c.createdAt
    return now - decidedAt < retentionMs
  })
  return { kept, prunedCount: commands.length - kept.length }
}

export class PendingCommandsStore {
  private readonly file: string

  constructor(configDir: string) {
    this.file = join(configDir, 'command-gateway', 'pending.json')
  }

  private load(): StoreFile {
    if (!existsSync(this.file)) return { version: 1, commands: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile
      if (parsed?.version !== 1 || !Array.isArray(parsed.commands)) {
        return { version: 1, commands: [] }
      }
      return parsed
    } catch {
      // Corrupt store → treat as empty; decisions are owner-recoverable.
      return { version: 1, commands: [] }
    }
  }

  private save(file: StoreFile): void {
    // Command payloads can embed sensitive context: owner-only permissions.
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.file)
  }

  /** Load + sweep expired pendings; persists the sweep result. */
  private loadSwept(): StoreFile {
    const file = this.load()
    const now = Date.now()
    const swept = sweepExpired(file.commands, now)
    const pruned = pruneTerminal(swept.kept, now)
    const kept = pruned.kept
    const changed = kept.length !== file.commands.length ||
      kept.some((c, i) => c !== file.commands[i])
    if (changed) {
      file.commands = kept
      this.save(file)
    }
    return file
  }

  create(input: CreatePendingCommandInput): PendingCommand {
    const file = this.loadSwept()
    const now = Date.now()
    const cmd: PendingCommand = {
      id: `cmd-${randomUUID()}`,
      workspaceId: input.workspaceId,
      source: input.source,
      appName: input.appName,
      command: input.command,
      reason: input.reason,
      impact: input.impact,
      requiresSystemPrompt: input.requiresSystemPrompt,
      createdAt: now,
      expiresAt: now + (input.ttlMs ?? DEFAULT_COMMAND_TTL_MS),
      status: 'pending',
    }
    file.commands.push(cmd)
    this.save(file)
    return cmd
  }

  listPending(workspaceId: string): PendingCommand[] {
    const file = this.loadSwept()
    return file.commands.filter((c) => c.workspaceId === workspaceId && c.status === 'pending')
  }

  decide(
    id: string,
    workspaceId: string,
    decision: 'approved' | 'denied',
    decidedBy: string,
  ): PendingCommand | null {
    const file = this.loadSwept()
    const cmd = file.commands.find(
      (c) => c.id === id && c.workspaceId === workspaceId && c.status === 'pending',
    )
    if (!cmd) return null
    cmd.status = decision
    cmd.decidedBy = decidedBy
    cmd.decidedAt = Date.now()
    this.save(file)
    return cmd
  }

  /** Executor-side lookup after restart: approved commands survive relaunch. */
  takeApproved(id: string, workspaceId: string): PendingCommand | null {
    const file = this.loadSwept()
    const cmd = file.commands.find(
      (c) => c.id === id && c.workspaceId === workspaceId && c.status === 'approved',
    )
    return cmd ?? null
  }

  get path(): string {
    return this.file
  }
}
