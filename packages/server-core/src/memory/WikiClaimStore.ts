/**
 * WikiClaimStore — manages the workspace wiki claims file
 * ({memoryDir}/wiki/claims.jsonl) for one memory scope (spec c1.7).
 *
 * The wiki is the evidence-backed layer on top of durable memory: each claim
 * is a single-sentence assertion with supporting evidence and a lifecycle
 * status. Claims are distilled from memory but NEVER injected through
 * `buildMemoryBlocks` — the wiki is a human/agent-inspected document surface,
 * not a prompt surface (asserted by a test).
 *
 * Idioms mirror LessonStore (spec F1/F2):
 * - Append-only fast path for brand-new claims under the cap; full atomic
 *   rewrite (tmp + rename) for updates/retracts and cap pruning.
 * - mtime-cached reads: the file is re-parsed only when its mtime changed.
 * - Corrupt lines are skipped, never thrown.
 * - Owner scoping: a claim row may carry an owner ({issuer, subject}); reads
 *   filter by owner key exactly like LessonStore.listForOwner.
 * - Every mutation appends to the scope's audit.jsonl through the internal
 *   AuditLog (`knowledge.claim.add|update|retire`).
 *
 * Frozen-DTO extension: the frozen `WikiClaim` has no owner tag and no
 * contradiction edges, so both live as extra keys on the persisted row and
 * round-trip untouched (unknown keys are never dropped). Contradiction edges
 * to RETIRED (or absent) claims are dropped on read and surfaced for lint.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { LessonOwner, LessonScope, WikiApplyResult, WikiClaim, WikiClaimEvidence, WikiClaimStatus, WikiMutation } from '@rox/shared/memory/types'
import type { AuditActor } from '@rox/shared/memory/types'
import { redactSecrets } from './MemoryService'
import { AuditLog, type AuditInput } from './AuditLog'

/** Caps enforced on every write (spec c1.7). */
export const WIKI_LIMITS = {
  /** Max claims kept per owner scope; the oldest (by updatedAt) are pruned. */
  claims: 200,
  /** Max evidence entries persisted per claim. */
  evidencePerClaim: 20,
  /** Max characters of a claim text / evidence quote / locator. */
  textChars: 2048,
  /** Max characters of an evidence source path. */
  sourceChars: 512,
} as const

const STATUSES: ReadonlySet<WikiClaimStatus> = new Set(['draft', 'active', 'stale', 'retracted'])

/**
 * A persisted claim row: the frozen `WikiClaim` plus the two store-level
 * extensions (owner tag, outbound contradiction edges).
 */
export type StoredWikiClaim = WikiClaim & {
  owner?: LessonOwner
  /** Ids of claims this one contradicts (outbound edges). */
  contradicts?: string[]
}

/** One contradiction edge dropped at read time because its target is retired/absent. */
export interface DroppedContradictionEdge {
  from: string
  to: string
  /** Why the edge was dropped: the target is retired, or is not a known claim. */
  reason: 'retired' | 'missing'
}

/** Missing owner denotes legacy machine-private data (mirrors LessonStore). */
export function wikiOwnerKey(owner?: LessonOwner): string {
  return owner ? `${owner.issuer}\u0000${owner.subject}` : ''
}

/** The owner tag carried by a (possibly extended) claim row. */
export function wikiClaimOwner(claim: WikiClaim): LessonOwner | undefined {
  const owner = (claim as StoredWikiClaim).owner
  return owner && typeof owner.issuer === 'string' && typeof owner.subject === 'string' ? owner : undefined
}

/** The outbound contradiction edge ids carried by a (possibly extended) claim row. */
export function wikiClaimContradicts(claim: WikiClaim): string[] {
  const edges = (claim as StoredWikiClaim).contradicts
  return Array.isArray(edges) ? edges.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
}

function normalizeOwner(value: unknown): LessonOwner | undefined {
  if (!value || typeof value !== 'object') return undefined
  const owner = value as { issuer?: unknown; subject?: unknown }
  if (typeof owner.issuer !== 'string' || owner.issuer.length === 0) return undefined
  if (typeof owner.subject !== 'string' || owner.subject.length === 0) return undefined
  return { issuer: owner.issuer, subject: owner.subject }
}

function normalizeEvidence(value: unknown): WikiClaimEvidence[] {
  if (!Array.isArray(value)) return []
  const out: WikiClaimEvidence[] = []
  for (const raw of value) {
    if (out.length >= WIKI_LIMITS.evidencePerClaim) break
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as { source?: unknown; locator?: unknown; ts?: unknown; quote?: unknown }
    if (typeof entry.source !== 'string' || entry.source.trim().length === 0) continue
    const evidence: WikiClaimEvidence = { source: redactSecrets(entry.source.trim()).slice(0, WIKI_LIMITS.sourceChars) }
    if (typeof entry.locator === 'string' && entry.locator.trim()) {
      evidence.locator = redactSecrets(entry.locator.trim()).slice(0, WIKI_LIMITS.textChars)
    }
    if (typeof entry.ts === 'string' && entry.ts.trim()) evidence.ts = entry.ts.trim()
    if (typeof entry.quote === 'string' && entry.quote.trim()) {
      evidence.quote = redactSecrets(entry.quote.trim()).slice(0, WIKI_LIMITS.textChars)
    }
    out.push(evidence)
  }
  return out
}

/**
 * Drop malformed schema fields while preserving unknown keys verbatim, so rows
 * from a newer writer round-trip untouched.
 */
function normalizeClaim(claim: StoredWikiClaim): StoredWikiClaim {
  if (typeof claim.text !== 'string') claim.text = ''
  if (!STATUSES.has(claim.status)) claim.status = 'draft'
  claim.evidence = normalizeEvidence(claim.evidence)
  const owner = normalizeOwner(claim.owner)
  if (owner) claim.owner = owner
  else delete claim.owner
  if (claim.contradicts !== undefined) {
    const edges = Array.isArray(claim.contradicts)
      ? [...new Set(claim.contradicts.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : []
    if (edges.length) claim.contradicts = edges
    else delete claim.contradicts
  }
  if (typeof claim.revision !== 'number' || !Number.isFinite(claim.revision) || claim.revision < 0) claim.revision = 0
  if (claim.scope !== undefined && typeof claim.scope !== 'string') delete claim.scope
  if (claim.createdAt !== undefined && typeof claim.createdAt !== 'string') delete claim.createdAt
  if (claim.updatedAt !== undefined && typeof claim.updatedAt !== 'string') delete claim.updatedAt
  return claim
}

/**
 * Parse a claims.jsonl payload resiliently. Blank lines are ignored and any
 * line that fails JSON.parse or lacks an id/text is skipped.
 */
export function parseWikiClaims(content: string): StoredWikiClaim[] {
  const claims: StoredWikiClaim[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as StoredWikiClaim
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && parsed.id.length > 0 && typeof parsed.text === 'string') {
        claims.push(normalizeClaim(parsed))
      }
    } catch {
      // skip corrupt line
    }
  }
  return claims
}

export interface WikiListOptions {
  owner?: LessonOwner
  /** Restrict to one wiki scope (e.g. 'workspace' or a project slug). */
  scope?: string
  status?: WikiClaimStatus
}

export interface WikiApplyOptions {
  owner?: LessonOwner
  actor?: AuditActor
  now?: Date
}

export class WikiClaimStore {
  /** {memoryDir}/wiki/claims.jsonl */
  readonly filePath: string
  readonly memoryDir: string
  readonly scope: LessonScope
  /** Scope's audit log (audit.jsonl next to claims) — wired internally. */
  readonly auditLog: AuditLog
  private cache: { mtimeMs: number; claims: StoredWikiClaim[] } | null = null

  constructor(memoryDir: string, scope: LessonScope = 'workspace') {
    this.memoryDir = memoryDir
    this.scope = scope
    this.filePath = join(memoryDir, 'wiki', 'claims.jsonl')
    this.auditLog = AuditLog.inDir(memoryDir, scope)
  }

  /** All claims (owner/scope/status filtered), file order. */
  list(opts?: WikiListOptions): WikiClaim[] {
    return this.readClaims(opts).claims
  }

  /** Read one claim by id, or null. With an owner, only that owner's rows match. */
  get(id: string, opts?: { owner?: LessonOwner }): WikiClaim | null {
    if (!id) return null
    const ownerKey = opts?.owner ? wikiOwnerKey(opts.owner) : null
    return this.list().find((claim) => claim.id === id && (ownerKey === null || wikiOwnerKey(wikiClaimOwner(claim)) === ownerKey)) ?? null
  }

  /**
   * Read claims with contradiction edges to retired/absent targets removed.
   * The dropped edges are returned so the lint can note them. `owner` absent
   * means "no owner filter" (every ownerless + owned row).
   */
  readClaims(opts?: WikiListOptions): { claims: WikiClaim[]; droppedContradictionEdges: DroppedContradictionEdge[] } {
    const ownerKey = opts?.owner ? wikiOwnerKey(opts.owner) : null
    let claims = this.read().filter((claim) => ownerKey === null || wikiOwnerKey(wikiClaimOwner(claim)) === ownerKey)
    if (opts?.scope !== undefined) claims = claims.filter((claim) => claim.scope === opts.scope)
    if (opts?.status !== undefined) claims = claims.filter((claim) => claim.status === opts.status)
    const byId = new Map(this.read().map((claim) => [claim.id, claim]))
    const dropped: DroppedContradictionEdge[] = []
    const projected = claims.map((claim) => {
      const edges = wikiClaimContradicts(claim)
      if (edges.length === 0) return { ...claim }
      const kept: string[] = []
      for (const to of edges) {
        const target = byId.get(to)
        if (!target) dropped.push({ from: claim.id, to, reason: 'missing' })
        else if (target.status === 'retracted') dropped.push({ from: claim.id, to, reason: 'retired' })
        else kept.push(to)
      }
      const next: StoredWikiClaim = { ...claim }
      if (kept.length) next.contradicts = kept
      else delete next.contradicts
      return next
    })
    return { claims: projected, droppedContradictionEdges: dropped }
  }

  /**
   * Apply one mutation and return the stored claim plus its revision.
   * Rejects empty text and a dangling contradiction id (a target claim id that
   * does not exist in this store).
   */
  apply(mutation: WikiMutation, opts?: WikiApplyOptions): WikiApplyResult {
    if (!mutation || (mutation.op !== 'upsert' && mutation.op !== 'retract')) {
      throw new Error('wiki apply: unknown mutation op')
    }
    return mutation.op === 'upsert' ? this.upsert(mutation.claim, opts) : this.retract(mutation.claimId, opts)
  }

  /** Drop the cache so the next read re-parses the file. */
  invalidate(): void {
    this.cache = null
  }

  private upsert(raw: WikiClaim, opts?: WikiApplyOptions): WikiApplyResult {
    if (!raw || typeof raw !== 'object') throw new Error('wiki apply: upsert requires a claim')
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!id) throw new Error('wiki apply: claim id is required')
    const text = redactSecrets(typeof raw.text === 'string' ? raw.text.trim() : '').slice(0, WIKI_LIMITS.textChars)
    if (!text) throw new Error('wiki apply: claim text is required')
    const status: WikiClaimStatus = STATUSES.has(raw.status) ? raw.status : 'draft'
    const owner = normalizeOwner(opts?.owner)
    const ownerKey = wikiOwnerKey(owner)
    const nowIso = (opts?.now ?? new Date()).toISOString()
    const claims = this.read()

    const incomingEdges = wikiClaimContradicts(raw).filter((target) => target !== id)
    const knownIds = new Set(claims.map((claim) => claim.id))
    for (const target of incomingEdges) {
      if (!knownIds.has(target)) throw new Error(`wiki apply: dangling contradiction id "${target}"`)
    }

    const existingIdx = claims.findIndex((claim) => claim.id === id && wikiOwnerKey(wikiClaimOwner(claim)) === ownerKey)
    const evidence = normalizeEvidence(raw.evidence)
    const base = existingIdx >= 0 ? claims[existingIdx] : undefined
    const stored: StoredWikiClaim = {
      ...(base ?? { id, revision: 0 }),
      id,
      text,
      status,
      evidence,
      revision: (base?.revision ?? 0) + 1,
      createdAt: base?.createdAt ?? nowIso,
      updatedAt: nowIso,
    }
    if (typeof raw.scope === 'string' && raw.scope.trim()) stored.scope = raw.scope.trim()
    else delete stored.scope
    if (incomingEdges.length) stored.contradicts = incomingEdges
    else delete stored.contradicts
    if (owner) stored.owner = owner
    else delete stored.owner

    if (existingIdx >= 0) claims[existingIdx] = stored
    else claims.push(stored)

    this.write(claims, ownerKey)
    this.auditWrite({
      actor: opts?.actor ?? 'rpc',
      action: existingIdx >= 0 ? 'knowledge.claim.update' : 'knowledge.claim.add',
      target: id,
      detail: `${status} (${evidence.length} evidence)`,
    })
    return { claim: stored, revision: stored.revision }
  }

  private retract(claimId: string, opts?: WikiApplyOptions): WikiApplyResult {
    const id = typeof claimId === 'string' ? claimId.trim() : ''
    if (!id) throw new Error('wiki apply: retract requires a claimId')
    const ownerKey = wikiOwnerKey(opts?.owner)
    const claims = this.read()
    const idx = claims.findIndex((claim) => claim.id === id && wikiOwnerKey(wikiClaimOwner(claim)) === ownerKey)
    if (idx < 0) throw new Error(`wiki apply: unknown claim id "${id}"`)
    const nowIso = (opts?.now ?? new Date()).toISOString()
    const stored: StoredWikiClaim = { ...claims[idx], status: 'retracted', revision: claims[idx].revision + 1, updatedAt: nowIso }
    claims[idx] = stored
    this.write(claims, ownerKey)
    this.auditWrite({ actor: opts?.actor ?? 'rpc', action: 'knowledge.claim.retire', target: id, detail: 'retracted' })
    return { claim: stored, revision: stored.revision }
  }

  /** Best-effort audit write — the secondary log must never break a mutation. */
  private auditWrite(input: AuditInput): void {
    try {
      this.auditLog.append(input)
    } catch {
      // auditing is best-effort; the mutation already landed
    }
  }

  private mtime(): number {
    try {
      return statSync(this.filePath).mtimeMs
    } catch {
      return -1
    }
  }

  private read(): StoredWikiClaim[] {
    if (!existsSync(this.filePath)) {
      this.cache = { mtimeMs: -1, claims: [] }
      return []
    }
    const mtimeMs = this.mtime()
    if (!this.cache || this.cache.mtimeMs !== mtimeMs) {
      this.cache = { mtimeMs, claims: parseWikiClaims(readFileSync(this.filePath, 'utf8')) }
    }
    return this.cache.claims.map((claim) => ({ ...claim }))
  }

  /**
   * Persist the claims for one owner scope: prune that owner's overflow (oldest
   * updatedAt first), then write a tmp file and rename it over the active file.
   */
  private write(claims: StoredWikiClaim[], ownerKey: string): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const positions = claims.map((claim, index) => ({ claim, index })).filter(({ claim }) => wikiOwnerKey(wikiClaimOwner(claim)) === ownerKey)
    const drop = new Set<number>()
    if (positions.length > WIKI_LIMITS.claims) {
      const overflow = positions.length - WIKI_LIMITS.claims
      const oldest = [...positions].sort((a, b) => {
        const at = a.claim.updatedAt ?? a.claim.createdAt ?? ''
        const bt = b.claim.updatedAt ?? b.claim.createdAt ?? ''
        return at < bt ? -1 : at > bt ? 1 : a.index - b.index
      })
      for (let i = 0; i < overflow; i++) drop.add(oldest[i].index)
    }
    const kept = claims.filter((_, index) => !drop.has(index))
    const tmp = join(dirname(this.filePath), `.${Date.now()}-${process.pid}.wiki.tmp`)
    writeFileSync(tmp, kept.map((claim) => JSON.stringify(claim)).join('\n') + (kept.length ? '\n' : ''))
    renameSync(tmp, this.filePath)
    this.cache = { mtimeMs: this.mtime(), claims: kept }
  }
}