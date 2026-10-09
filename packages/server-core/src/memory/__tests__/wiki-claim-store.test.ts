/**
 * c1.7 workspace memory wiki: WikiClaimStore round-trips, caps, owner scoping,
 * contradiction edges, lint determinism and the "wiki never enters the prompt"
 * invariant.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'bun:test'
import type { WikiClaim, WikiMutation } from '@rox/shared/memory/types'
import { WIKI_LIMITS, WikiClaimStore, wikiClaimContradicts } from '../WikiClaimStore'
import { buildClaimHealth, buildContradictionClusters, buildLintFindings, compileWikiDigest } from '../wiki-lint'
import { MemoryService } from '../MemoryService'
import { LessonStore } from '../LessonStore'
import { MemoryFileStore } from '../MemoryFileStore'
import { memoryIndexServiceFor } from '../MemoryIndexService'
import { forgetMemoryChunks } from '../forget'
import { AuditLog } from '../AuditLog'
import { closeAll } from '../fts-index'

const roots: string[] = []
function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'wiki-'))
  roots.push(root)
  return root
}
afterEach(() => {
  closeAll()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const OWNER_A = { issuer: 'rox', subject: 'alice' }
const OWNER_B = { issuer: 'rox', subject: 'bob' }

function upsert(store: WikiClaimStore, claim: Partial<WikiClaim> & { id: string; text: string }, owner?: { issuer: string; subject: string }, extra?: { contradicts?: string[] }): void {
  const mutation = {
    op: 'upsert',
    claim: {
      id: claim.id,
      text: claim.text,
      status: claim.status ?? 'active',
      evidence: claim.evidence ?? [],
      revision: claim.revision ?? 0,
      ...(claim.scope ? { scope: claim.scope } : {}),
      ...(extra?.contradicts ? { contradicts: extra.contradicts } : {}),
    },
  } as unknown as WikiMutation
  store.apply(mutation, owner ? { owner } : undefined)
}

describe('WikiClaimStore', () => {
  it('round-trips a claim with evidence and bumps the revision on update', () => {
    const store = new WikiClaimStore(join(tmpRoot(), 'memory'))
    const first = store.apply({ op: 'upsert', claim: { id: 'c1', text: 'Deploys go through vercel.', status: 'active', evidence: [{ source: 'memory/context.md', quote: 'vercel' }], revision: 0 } })
    expect(first.claim.id).toBe('c1')
    expect(first.revision).toBe(1)
    expect(store.get('c1')?.evidence).toHaveLength(1)
    const second = store.apply({ op: 'upsert', claim: { id: 'c1', text: 'Deploys go through vercel.', status: 'active', evidence: [{ source: 'memory/context.md' }, { source: 'memory/history/2026-01-01.md' }], revision: 0 } })
    expect(second.revision).toBe(2)
    expect(store.list()).toHaveLength(1)
    expect(store.get('c1')?.evidence).toHaveLength(2)
  })

  it('skips corrupt lines and never throws', () => {
    const root = tmpRoot()
    const dir = join(root, 'memory', 'wiki')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'claims.jsonl'), [
      JSON.stringify({ id: 'c1', text: 'one', status: 'active', evidence: [], revision: 1 }),
      '{ not json',
      JSON.stringify({ id: 'c2', text: 'two', status: 'draft', evidence: [], revision: 1 }),
      '',
    ].join('\n'))
    const store = new WikiClaimStore(join(root, 'memory'))
    expect(store.list().map(c => c.id).sort()).toEqual(['c1', 'c2'])
  })

  it('caps claims, evidence per claim and text length', () => {
    const store = new WikiClaimStore(join(tmpRoot(), 'memory'))
    for (let i = 0; i < WIKI_LIMITS.claims + 5; i++) upsert(store, { id: `c${i}`, text: `claim ${i}` })
    const claims = store.list()
    expect(claims).toHaveLength(WIKI_LIMITS.claims)
    // The oldest (c0..c4) are pruned; the newest survive.
    expect(claims.some(c => c.id === 'c0')).toBe(false)
    expect(claims.some(c => c.id === `c${WIKI_LIMITS.claims + 4}`)).toBe(true)

    const many = Array.from({ length: WIKI_LIMITS.evidencePerClaim + 5 }, (_, i) => ({ source: `s${i}` }))
    store.apply({ op: 'upsert', claim: { id: 'ev', text: 'evidence cap', status: 'active', evidence: many, revision: 0 } })
    expect(store.get('ev')?.evidence).toHaveLength(WIKI_LIMITS.evidencePerClaim)

    store.apply({ op: 'upsert', claim: { id: 'long', text: 'x'.repeat(WIKI_LIMITS.textChars + 500), status: 'active', evidence: [], revision: 0 } })
    expect(store.get('long')?.text).toHaveLength(WIKI_LIMITS.textChars)
  })

  it('filters by owner', () => {
    const store = new WikiClaimStore(join(tmpRoot(), 'memory'))
    upsert(store, { id: 'a1', text: 'alice claim' }, OWNER_A)
    upsert(store, { id: 'b1', text: 'bob claim' }, OWNER_B)
    expect(store.list({ owner: OWNER_A }).map(c => c.id)).toEqual(['a1'])
    expect(store.list({ owner: OWNER_B }).map(c => c.id)).toEqual(['b1'])
    expect(store.list()).toHaveLength(2)
  })

  it('rejects empty text and a dangling contradiction id', () => {
    const store = new WikiClaimStore(join(tmpRoot(), 'memory'))
    expect(() => store.apply({ op: 'upsert', claim: { id: 'x', text: '   ', status: 'active', evidence: [], revision: 0 } })).toThrow(/text/)
    expect(() => upsert(store, { id: 'x', text: 'x', status: 'active' }, undefined, { contradicts: ['missing'] })).toThrow(/dangling/)
  })

  it('drops contradiction edges to retired claims on read', () => {
    const store = new WikiClaimStore(join(tmpRoot(), 'memory'))
    upsert(store, { id: 'a', text: 'a', status: 'active' })
    upsert(store, { id: 'b', text: 'b', status: 'active' }, undefined, { contradicts: ['a'] })
    expect(wikiClaimContradicts(store.get('b')!)).toEqual(['a'])
    store.apply({ op: 'retract', claimId: 'a' })
    const { claims, droppedContradictionEdges } = store.readClaims()
    const b = claims.find(c => c.id === 'b')!
    expect(wikiClaimContradicts(b)).toEqual([])
    expect(droppedContradictionEdges).toContainEqual({ from: 'b', to: 'a', reason: 'retired' })
    const findings = buildLintFindings({ claims, now: new Date('2026-06-01T00:00:00.000Z'), droppedContradictionEdges })
    expect(findings.some(f => f.code === 'dangling-contradiction')).toBe(true)
  })

  it('records an audit line per mutation', () => {
    const root = tmpRoot()
    const store = new WikiClaimStore(join(root, 'memory'))
    upsert(store, { id: 'c1', text: 'one', status: 'active' })
    upsert(store, { id: 'c1', text: 'one', status: 'active' })
    store.apply({ op: 'retract', claimId: 'c1' })
    const actions = new AuditLog('workspace', undefined, undefined, join(root, 'memory')).read().map(e => e.action)
    expect(actions).toEqual(['knowledge.claim.retire', 'knowledge.claim.update', 'knowledge.claim.add'])
  })
})

describe('wiki-lint', () => {
  const NOW = new Date('2026-06-01T00:00:00.000Z')
  function claims(): WikiClaim[] {
    return [
      { id: 'a', text: 'a', status: 'active', evidence: [], revision: 1, updatedAt: '2026-05-30T00:00:00.000Z' },
      { id: 'b', text: 'b', status: 'active', evidence: [{ source: 's' }], revision: 1, updatedAt: '2025-01-01T00:00:00.000Z' },
      { id: 'c', text: 'c', status: 'retracted', evidence: [], revision: 2, updatedAt: '2026-05-31T00:00:00.000Z' },
    ]
  }

  it('classifies missing evidence, low confidence and stale claims', () => {
    const health = buildClaimHealth(claims(), NOW)
    expect(health.total).toBe(3)
    expect(health.missingEvidence).toEqual(['a', 'c'])
    expect(health.lowConfidence).toEqual(['b'])
    expect(health.stale).toEqual(['b'])
  })

  it('clusters contradiction edges in a stable order', () => {
    const withEdges: WikiClaim[] = [
      { id: 'b', text: 'b', status: 'active', evidence: [], revision: 1, contradicts: ['a'] } as WikiClaim,
      { id: 'a', text: 'a', status: 'active', evidence: [], revision: 1 },
      { id: 'c', text: 'c', status: 'active', evidence: [], revision: 1 },
    ]
    expect(buildContradictionClusters(withEdges)).toEqual([{ ids: ['a', 'b'] }])
  })

  it('writes a byte-identical digest across two runs', () => {
    const root = tmpRoot()
    const store = new WikiClaimStore(join(root, 'memory'))
    upsert(store, { id: 'z', text: 'zed', status: 'active', evidence: [{ source: 'memory/context.md' }] })
    upsert(store, { id: 'a', text: 'alpha', status: 'active', evidence: [] })

    const first = compileWikiDigest({ memoryDir: join(root, 'memory'), now: NOW })
    const firstBytes = readFileSync(first.digestPath)
    const second = compileWikiDigest({ memoryDir: join(root, 'memory'), now: NOW })
    const secondBytes = readFileSync(second.digestPath)
    expect(firstBytes.equals(secondBytes)).toBe(true)
    expect(second.report).toEqual(first.report)
    expect(first.report.claimsChecked).toBe(2)
    expect(first.report.findings.some(f => f.code === 'unsupported-claim' && f.claimId === 'a')).toBe(true)
  })

  it('flags evidence-missing for a non-live source and never crashes', () => {
    const root = tmpRoot()
    const store = new WikiClaimStore(join(root, 'memory'))
    upsert(store, { id: 'k', text: 'known', status: 'active', evidence: [{ source: 'gone' }] })
    const { report } = compileWikiDigest({ memoryDir: join(root, 'memory'), now: NOW, isEvidenceLive: () => false })
    expect(report.findings.some(f => f.code === 'evidence-missing' && f.claimId === 'k')).toBe(true)
    const thrown = compileWikiDigest({ memoryDir: join(root, 'memory'), now: NOW, isEvidenceLive: () => { throw new Error('boom') } })
    expect(thrown.report.findings.some(f => f.code === 'evidence-missing')).toBe(true)
  })

  it('flags evidence-missing after the referenced memory is forgotten', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'memory'), { recursive: true })
    writeFileSync(join(root, 'memory', 'context.md'), 'Deploy previews go through vercel.')
    const index = memoryIndexServiceFor(root, 'ws')
    index.rebuild()
    const hit = index.search('deploy', 5).hits[0]!

    const store = new WikiClaimStore(join(root, 'memory'))
    upsert(store, { id: 'deploy', text: 'Deploys go through vercel.', status: 'active', evidence: [{ source: hit.chunkId }] })
    const isLive = (evidence: { source: string }): boolean => index.get(evidence.source) !== null
    expect(compileWikiDigest({ memoryDir: join(root, 'memory'), now: NOW, isEvidenceLive: isLive }).report.findings.some(f => f.code === 'evidence-missing')).toBe(false)

    const result = forgetMemoryChunks({ index, workspaceRoot: root, audit: new AuditLog('workspace', root), ids: [hit.chunkId], by: 'user' })
    expect(result.forgotten).toContain(hit.chunkId)
    const after = compileWikiDigest({ memoryDir: join(root, 'memory'), now: NOW, isEvidenceLive: isLive })
    expect(after.report.findings.some(f => f.code === 'evidence-missing' && f.claimId === 'deploy')).toBe(true)
  })
})

describe('the wiki never enters buildMemoryBlocks', () => {
  function service(root: string): MemoryService {
    const fileStore = new MemoryFileStore('workspace', root)
    const workspaceLessons = new LessonStore(fileStore.lessonsPath, 'workspace')
    const globalLessons = new LessonStore(new MemoryFileStore('global', root, join(root, 'config')).lessonsPath, 'global')
    return new MemoryService({
      workspaceRoot: root,
      workspaceId: 'ws',
      fileStore,
      lessonStoreFactory: (scope) => (scope === 'global' ? globalLessons : workspaceLessons),
      logger: { warn: () => {} },
      emit: () => {},
      getConfig: () => ({ enabled: true, distillIdleHours: 3, distillMsgCount: 30, negativeFirst: true, redactExtraPatterns: [], ftsLimit: 20, semantic: false, dreamIntervalHours: 4, dreamNotes: true }),
    })
  }

  it('produces byte-identical blocks before and after wiki writes', async () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'memory'), { recursive: true })
    writeFileSync(join(root, 'memory', 'context.md'), 'Workspace context.')
    const svc = service(root)
    const before = JSON.stringify(await svc.buildMemoryBlocks())

    const store = new WikiClaimStore(join(root, 'memory'))
    upsert(store, { id: 'w1', text: 'A distilled claim.', status: 'active', evidence: [{ source: 'memory/context.md' }] })
    upsert(store, { id: 'w2', text: 'Another claim.', status: 'active', evidence: [] })
    compileWikiDigest({ memoryDir: join(root, 'memory') })

    const after = JSON.stringify(await svc.buildMemoryBlocks())
    expect(after).toBe(before)
    expect(existsSync(join(root, 'memory', 'wiki', 'claims.jsonl'))).toBe(true)
    expect(after.includes('A distilled claim.')).toBe(false)
  })
})