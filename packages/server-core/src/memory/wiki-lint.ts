/**
 * wiki-lint — claim health, contradiction clustering and the deterministic
 * wiki digest (spec c1.7).
 *
 * Pure layer:
 * - `buildClaimHealth(claims, now)` classifies unsupported / low-confidence /
 *   stale claims. No I/O, no wall clock: `now` is always passed in, so the same
 *   input yields the same output.
 * - `buildContradictionClusters(claims)` unions the contradiction edges into
 *   connected clusters in a stable order (ids sorted, clusters sorted).
 *
 * Effectful layer:
 * - `buildLintFindings(...)` turns the pure outputs — plus an optional evidence
 *   liveness resolver — into typed findings. `evidence-missing` is reported when
 *   a claim's evidence source is no longer live (e.g. the referenced memory was
 *   forgotten), and never crashes on unreadable evidence.
 * - `compileWikiDigest(scope)` reads the store, builds the report and atomically
 *   writes deterministic markdown to `{memoryDir}/wiki/WIKI.md`.
 */
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import type { LessonOwner, LessonScope, WikiClaim, WikiClaimEvidence, WikiLintFinding, WikiLintReport } from '@rox/shared/memory/types'
import { WikiClaimStore, wikiClaimContradicts, type DroppedContradictionEdge } from './WikiClaimStore'

/** A claim untouched for this many days is flagged stale. */
export const WIKI_STALE_DAYS = 90
/** A live claim backed by a single evidence entry is flagged low-confidence. */
export const WIKI_LOW_CONFIDENCE_MAX_EVIDENCE = 1

export interface ClaimHealth {
  total: number
  /** Ids of claims with no evidence at all. */
  missingEvidence: string[]
  /** Ids of active claims backed by a single evidence entry. */
  lowConfidence: string[]
  /** Ids of active claims not updated within WIKI_STALE_DAYS. */
  stale: string[]
}

export interface ContradictionCluster {
  /** Member claim ids, sorted ascending. */
  ids: string[]
}

/** Predicate deciding whether an evidence entry still resolves to live memory. */
export type WikiEvidenceResolver = (evidence: WikiClaimEvidence, claim: WikiClaim) => boolean

function iso(now: Date | string): number {
  const ms = now instanceof Date ? now.getTime() : Date.parse(now)
  return Number.isFinite(ms) ? ms : Date.parse(new Date().toISOString())
}

/**
 * Pure claim-health classification (spec c1.7). Deterministic: claims are
 * examined in input order and ids are collected in that same order.
 */
export function buildClaimHealth(claims: readonly WikiClaim[], now: Date | string = new Date()): ClaimHealth {
  const nowMs = iso(now)
  const missingEvidence: string[] = []
  const lowConfidence: string[] = []
  const stale: string[] = []
  const staleCutoff = nowMs - WIKI_STALE_DAYS * 24 * 60 * 60 * 1000
  for (const claim of claims) {
    const evidence = Array.isArray(claim.evidence) ? claim.evidence : []
    if (evidence.length === 0) missingEvidence.push(claim.id)
    const active = claim.status === 'active'
    if (active && evidence.length > 0 && evidence.length <= WIKI_LOW_CONFIDENCE_MAX_EVIDENCE) lowConfidence.push(claim.id)
    if (active) {
      const updated = claim.updatedAt ?? claim.createdAt
      const updatedMs = updated ? Date.parse(updated) : Number.NaN
      if (!Number.isFinite(updatedMs) || updatedMs < staleCutoff) stale.push(claim.id)
    }
  }
  return { total: claims.length, missingEvidence, lowConfidence, stale }
}

/**
 * Union the contradiction edges into connected clusters (spec c1.7). Edges to
 * ids that are not present in `claims` are ignored. Deterministic: member ids
 * are sorted and clusters are sorted by their first id.
 */
export function buildContradictionClusters(claims: readonly WikiClaim[]): ContradictionCluster[] {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!
    while (parent.get(id) !== undefined && parent.get(id) !== root) {
      const next = parent.get(id)!
      parent.set(id, root)
      id = next
    }
    return root
  }
  const union = (a: string, b: string): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const known = new Set<string>()
  for (const claim of claims) {
    known.add(claim.id)
    if (!parent.has(claim.id)) parent.set(claim.id, claim.id)
  }
  for (const claim of claims) {
    for (const to of wikiClaimContradicts(claim)) {
      if (known.has(to)) union(claim.id, to)
    }
  }
  const groups = new Map<string, string[]>()
  for (const id of known) {
    const root = find(id)
    const list = groups.get(root)
    if (list) list.push(id)
    else groups.set(root, [id])
  }
  const clusters = [...groups.values()]
    .filter((ids) => ids.length >= 2)
    .map((ids) => ({ ids: [...ids].sort() }))
  clusters.sort((a, b) => (a.ids[0]! < b.ids[0]! ? -1 : 1))
  return clusters
}

export interface LintFindingInput {
  claims: readonly WikiClaim[]
  now?: Date | string
  /** When provided, evidence that does not resolve is flagged `evidence-missing`. */
  isEvidenceLive?: WikiEvidenceResolver
  /** Contradiction edges dropped at read time (target retired/absent). */
  droppedContradictionEdges?: readonly DroppedContradictionEdge[]
}

/**
 * Build the typed lint findings. Findings are sorted by (claimId, code,
 * message) so the report order is independent of store iteration order.
 */
export function buildLintFindings(input: LintFindingInput): WikiLintFinding[] {
  const findings: WikiLintFinding[] = []
  const health = buildClaimHealth(input.claims, input.now ?? new Date())
  for (const id of health.missingEvidence) {
    findings.push({ claimId: id, severity: 'warning', code: 'unsupported-claim', message: 'Claim has no supporting evidence.' })
  }
  for (const id of health.lowConfidence) {
    findings.push({ claimId: id, severity: 'info', code: 'low-confidence', message: 'Claim is backed by a single evidence entry.' })
  }
  for (const id of health.stale) {
    findings.push({ claimId: id, severity: 'warning', code: 'stale-claim', message: `Claim has not been updated in over ${WIKI_STALE_DAYS} days.` })
  }
  if (input.isEvidenceLive) {
    for (const claim of input.claims) {
      for (const evidence of Array.isArray(claim.evidence) ? claim.evidence : []) {
        let live = false
        try {
          live = input.isEvidenceLive(evidence, claim)
        } catch {
          // An evidence resolver must never break the lint; a throw means "not live".
          live = false
        }
        if (!live) {
          findings.push({
            claimId: claim.id,
            severity: 'warning',
            code: 'evidence-missing',
            message: `Evidence source "${evidence.source}" no longer resolves.`,
          })
        }
      }
    }
  }
  for (const cluster of buildContradictionClusters(input.claims)) {
    findings.push({ severity: 'info', code: 'contradiction-cluster', message: `Contradicting claims: ${cluster.ids.join(', ')}.` })
  }
  const seenDropped = new Set<string>()
  for (const edge of input.droppedContradictionEdges ?? []) {
    const key = `${edge.from}\u0000${edge.to}`
    if (seenDropped.has(key)) continue
    seenDropped.add(key)
    findings.push({
      severity: 'info',
      code: 'dangling-contradiction',
      message: `Contradiction edge ${edge.from} → ${edge.to} was dropped (target ${edge.reason === 'retired' ? 'is retired' : 'is unknown'}).`,
    })
  }
  findings.sort((a, b) => {
    const ac = a.claimId ?? ''
    const bc = b.claimId ?? ''
    if (ac !== bc) return ac < bc ? -1 : 1
    if (a.code !== b.code) return a.code < b.code ? -1 : 1
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0
  })
  return findings
}

/** Deterministic markdown body for the wiki digest document. */
export function renderWikiDigest(claims: readonly WikiClaim[], findings: readonly WikiLintFinding[]): string {
  const lines: string[] = ['# Workspace memory wiki', '', `Claims: ${claims.length}`, '', '## Claims', '']
  const sortedClaims = [...claims].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (sortedClaims.length === 0) {
    lines.push('_(none)_')
  } else {
    for (const claim of sortedClaims) {
      const evidence = Array.isArray(claim.evidence) ? claim.evidence : []
      const edges = wikiClaimContradicts(claim)
      const suffix = [
        `status ${claim.status}`,
        `revision ${claim.revision}`,
        `evidence ${evidence.length}`,
        ...(edges.length ? [`contradicts ${[...edges].sort().join(', ')}`] : []),
      ].join('; ')
      lines.push(`- [${claim.id}] ${claim.text} (${suffix})`)
    }
  }
  lines.push('', '## Contradiction clusters', '')
  const clusters = buildContradictionClusters(claims)
  if (clusters.length === 0) {
    lines.push('_(none)_')
  } else {
    for (const cluster of clusters) lines.push(`- ${cluster.ids.join(' ↔ ')}`)
  }
  lines.push('', '## Lint', '')
  if (findings.length === 0) {
    lines.push('_(clean)_')
  } else {
    for (const finding of findings) {
      const where = finding.claimId ? ` (${finding.claimId})` : ''
      lines.push(`- [${finding.severity}] ${finding.code}${where}: ${finding.message}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

export interface WikiDigestScope {
  /** Scope's memory dir: the store lives at {memoryDir}/wiki/claims.jsonl. */
  memoryDir: string
  scope?: LessonScope
  owner?: LessonOwner
  now?: Date | string
  isEvidenceLive?: WikiEvidenceResolver
}

/**
 * Compile the wiki digest: read the store, build the lint report and write
 * `{memoryDir}/wiki/WIKI.md` atomically. The document body is deterministic
 * (ordered ids, no wall clock), so two runs over the same claims produce a
 * byte-identical file.
 */
export function compileWikiDigest(scope: WikiDigestScope): { report: WikiLintReport; digestPath: string } {
  const now = scope.now ?? new Date()
  const store = new WikiClaimStore(scope.memoryDir, scope.scope ?? 'workspace')
  const { claims, droppedContradictionEdges } = store.readClaims({ owner: scope.owner })
  const findings = buildLintFindings({
    claims,
    now,
    ...(scope.isEvidenceLive ? { isEvidenceLive: scope.isEvidenceLive } : {}),
    droppedContradictionEdges,
  })
  const report: WikiLintReport = {
    findings,
    claimsChecked: claims.length,
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  }
  const digestPath = join(scope.memoryDir, 'wiki', 'WIKI.md')
  mkdirSync(dirname(digestPath), { recursive: true })
  atomicWriteFileSync(digestPath, renderWikiDigest(claims, findings), { durable: true })
  return { report, digestPath }
}