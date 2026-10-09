/**
 * W1-11 (#1508) — Local-mode audit log: JSONL under `{configDir}/audit/`
 * (TECH-SPEC §13.4, DATA-MODEL §5.13 "Local-only mode").
 *
 * One file per month (`audit-YYYY-MM.jsonl`), one row per line, in the same
 * order and with the same `sha256(prev_hash ‖ canonical row)` chain as
 * `audit_log` on the server, so a chain written here verifies there and vice
 * versa (`@rox/core/agents/audit` holds both ends of the chain).
 *
 * The directory is private (0700) and every file is written 0600, because the
 * rows carry who an agent acted for and what it was allowed to do. Appends are
 * serialised per instance: a command executor runs one command at a time per
 * workspace, and the class also serialises its own writes so two agents cannot
 * interleave a line.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveConfigDir } from '@rox/shared/config/paths'
import {
  AUDIT_RETENTION_DAYS,
  chainAuditRow,
  verifyAuditChain,
  type AuditChainVerification,
  type AuditRow,
  type AuditRowInput,
} from '@rox/core/agents'

/** File name of one month's chain. */
export function auditFileName(month: string): string {
  return `audit-${month}.jsonl`
}

/** `YYYY-MM` of an ISO timestamp (UTC, so the name never depends on the locale). */
export function auditMonthOf(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export interface JsonlAuditLogOptions {
  /** Defaults to `CRAFT_CONFIG_DIR` (tests) then `resolveConfigDir()` (`~/rox`). */
  configDir?: string
  /** Retention window kept by the reader (`AUDIT_RETENTION_DAYS` by default). */
  retentionDays?: number
}

/**
 * Append-only audit chain in JSONL. Writes are synchronous on purpose: the
 * audit row must be on disk before the command receipt is returned, so a crash
 * cannot lose the record of an action that already took effect.
 */
export class JsonlAuditLog {
  readonly directory: string
  private readonly retentionDays: number
  /** Tail of each month's chain, so an append does not re-read the file. */
  private readonly tails = new Map<string, AuditRow | null>()

  constructor(options: JsonlAuditLogOptions = {}) {
    const configDir = options.configDir ?? process.env.CRAFT_CONFIG_DIR ?? resolveConfigDir()
    this.directory = join(configDir, 'audit')
    this.retentionDays = options.retentionDays ?? AUDIT_RETENTION_DAYS
  }

  filePathFor(month: string): string {
    return join(this.directory, auditFileName(month))
  }

  /** Create the private directory (0700) on first write. */
  private ensureDirectory(): void {
    if (!existsSync(this.directory)) mkdirSync(this.directory, { recursive: true, mode: 0o700 })
  }

  /** The last row of a month's chain, or `null` when the file is absent / empty. */
  tail(month: string): AuditRow | null {
    if (this.tails.has(month)) return this.tails.get(month) ?? null
    const file = this.filePathFor(month)
    let tail: AuditRow | null = null
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim()
        if (!line) continue
        tail = JSON.parse(line) as AuditRow
        break
      }
    }
    this.tails.set(month, tail)
    return tail
  }

  /** Append one row to its month's chain; returns the stored row. */
  append(row: AuditRowInput): AuditRow {
    const month = auditMonthOf(row.createdAt)
    const chained = chainAuditRow(this.tail(month), row)
    this.ensureDirectory()
    const seq = (this.tail(month)?.seq ?? 0) + 1
    const stored: AuditRow = { ...chained, seq }
    appendFileSync(this.filePathFor(month), `${JSON.stringify(stored)}\n`, { encoding: 'utf8', mode: 0o600 })
    try { chmodSync(this.filePathFor(month), 0o600) } catch { /* best effort on exotic filesystems */ }
    this.tails.set(month, stored)
    return stored
  }

  /** Every row of one month, in chain order. */
  read(month: string): AuditRow[] {
    const file = this.filePathFor(month)
    if (!existsSync(file)) return []
    const rows: AuditRow[] = []
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (trimmed) rows.push(JSON.parse(trimmed) as AuditRow)
    }
    return rows
  }

  /** Months present on disk that are still inside the retention window, oldest first. */
  months(): string[] {
    if (!existsSync(this.directory)) return []
    const cutoff = auditMonthOf(new Date(Date.now() - this.retentionDays * 86_400_000))
    return readdirSync(this.directory)
      .map(name => /^audit-(\d{4}-\d{2})\.jsonl$/.exec(name)?.[1])
      .filter((month): month is string => typeof month === 'string' && month >= cutoff)
      .sort()
  }

  /** Verify one month's chain (the verifier reports the first damaged row). */
  verifyMonth(month: string): AuditChainVerification {
    return verifyAuditChain(this.read(month))
  }

  /** Verify every retained month; the first failure wins. */
  verify(): AuditChainVerification & { month?: string } {
    let rows = 0
    for (const month of this.months()) {
      const verification = this.verifyMonth(month)
      rows += verification.rows
      if (!verification.ok) return { ...verification, rows, month }
    }
    return { ok: true, rows }
  }
}