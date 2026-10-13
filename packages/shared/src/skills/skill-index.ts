/**
 * Incremental skill catalog index (ADR-0023 §5–6, #1865).
 * Cold scans run in the worker pool; warm refresh re-reads heads only when
 * mtime/size changed. A JSON snapshot under the config dir serves the first
 * query after an unchanged restart with 0 head reads.
 */
import { join } from 'node:path'
import matter from 'gray-matter'
import { resolveConfigDir } from '../config/paths.ts'
import { getWorkerPool } from '../workers/index.ts'
import { APP_MANAGED_SKILLS_DIR, getSkillRootPlan, type SkillRootPlanEntry } from './storage.ts'
import { isSafeSkillName } from './managed.ts'
import type { LoadedSkill, SkillSource } from './types.ts'
import './skill-index-worker.ts'

export const SKILLS_QUERY_LIMIT_CAP = 500
export const SKILLS_CHANGED_COALESCE_MS = 250

export interface SkillIndexIo {
  readdir(dir: string): Promise<string[]>
  stat(path: string): Promise<{ mtimeMs: number; size: number; isFile: boolean } | null>
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string): Promise<void>
}

export interface SkillIndexRecord {
  path: string
  slug: string
  source: SkillSource
  root: string
  size: number
  mtimeMs: number
  name: string
  description: string
}

export interface SkillsQueryArgs {
  workspaceRoot: string
  projectRoot?: string
  query?: string
  offset?: number
  limit?: number
  sources?: SkillSource[]
  slugs?: string[]
}

export interface SkillsQueryResult {
  items: LoadedSkill[]
  total: number
  revision: number
}

export interface SkillsChangedPayload {
  revision: number
  changed: string[]
  removed: string[]
}

let io: SkillIndexIo = defaultIo()
let usingTestIo = false
let records = new Map<string, SkillIndexRecord>()
let revision = 0
let snapshotLoaded = false
const pendingChanged = new Set<string>()
const pendingRemoved = new Set<string>()
const listeners = new Set<(payload: SkillsChangedPayload) => void>()
let coalesceTimer: unknown = null
type CoalesceClock = {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}
const realCoalesceClock: CoalesceClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => { clearTimeout(id as ReturnType<typeof setTimeout>) },
}
let coalesceClock: CoalesceClock = realCoalesceClock

function defaultIo(): SkillIndexIo {
  const fs = require('node:fs/promises') as typeof import('node:fs/promises')
  return {
    async readdir(dir) {
      try { return await fs.readdir(dir) } catch { return [] }
    },
    async stat(path) {
      try {
        const st = await fs.stat(path)
        return { mtimeMs: st.mtimeMs, size: st.size, isFile: st.isFile() }
      } catch { return null }
    },
    async readFile(path) {
      return fs.readFile(path, 'utf8')
    },
    async writeFile(path, data) {
      await fs.writeFile(path, data, 'utf8')
    },
    async mkdir(path) {
      await fs.mkdir(path, { recursive: true })
    },
  }
}

export function setSkillIndexIoForTests(next: SkillIndexIo | null): void {
  usingTestIo = next != null
  io = next ?? defaultIo()
}

export function resetSkillIndexForTests(): void {
  records = new Map()
  revision = 0
  snapshotLoaded = false
  pendingChanged.clear()
  pendingRemoved.clear()
  if (coalesceTimer) coalesceClock.clearTimeout(coalesceTimer)
  coalesceTimer = null
  listeners.clear()
}

export function setSkillIndexCoalesceClockForTests(clock: CoalesceClock | null): void {
  if (coalesceTimer) coalesceClock.clearTimeout(coalesceTimer)
  coalesceTimer = null
  coalesceClock = clock ?? realCoalesceClock
}

function snapshotPath(): string {
  return join(resolveConfigDir(), 'skill-catalog-index.json')
}

function parseHead(text: string, slug: string): { name: string; description: string } | null {
  try {
    const parsed = matter(text, {})
    if (!parsed.data.name || !parsed.data.description) return null
    return { name: String(parsed.data.name), description: String(parsed.data.description) }
  } catch {
    return { name: slug, description: '' }
  }
}

function toSummary(record: SkillIndexRecord): LoadedSkill {
  return {
    slug: record.slug,
    path: record.path,
    source: record.source,
    content: '',
    contentLength: record.size,
    metadata: { name: record.name, description: record.description },
  }
}

function emitSoon(changed: string[], removed: string[]): void {
  for (const slug of changed) pendingChanged.add(slug)
  for (const slug of removed) pendingRemoved.add(slug)
  if (coalesceTimer) return
  coalesceTimer = coalesceClock.setTimeout(() => {
    coalesceTimer = null
    revision++
    const payload: SkillsChangedPayload = {
      revision,
      changed: [...pendingChanged],
      removed: [...pendingRemoved],
    }
    pendingChanged.clear()
    pendingRemoved.clear()
    for (const listener of listeners) listener(payload)
  }, SKILLS_CHANGED_COALESCE_MS)
}

export function subscribeSkillIndexChanged(listener: (payload: SkillsChangedPayload) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

async function loadSnapshot(): Promise<void> {
  snapshotLoaded = true
  try {
    const raw = await io.readFile(snapshotPath())
    const parsed = JSON.parse(raw) as { revision?: number; records?: SkillIndexRecord[] }
    if (Array.isArray(parsed.records)) {
      records = new Map(parsed.records.map((row) => [row.path, row]))
      revision = parsed.revision ?? 0
    }
  } catch {
    records = new Map()
  }
}

async function saveSnapshot(): Promise<void> {
  try {
    await io.mkdir(resolveConfigDir())
    await io.writeFile(snapshotPath(), JSON.stringify({ revision, records: [...records.values()] }))
  } catch {
    // Snapshot is a cache; a failed write must not fail the query.
  }
}

async function scanRootWithIo(tier: SkillRootPlanEntry): Promise<SkillIndexRecord[]> {
  const names = await io.readdir(tier.root)
  const out: SkillIndexRecord[] = []
  for (const name of names) {
    if (!isSafeSkillName(name)) continue
    const dir = join(tier.root, name)
    if (tier.excludeAppManaged && (dir === APP_MANAGED_SKILLS_DIR || dir.startsWith(APP_MANAGED_SKILLS_DIR + '/'))) continue
    const headPath = join(dir, 'SKILL.md')
    const st = await io.stat(headPath)
    if (!st?.isFile) continue
    const text = await io.readFile(headPath)
    const meta = parseHead(text, name)
    if (!meta) continue
    out.push({
      path: dir, slug: name, source: tier.source, root: tier.root,
      size: st.size, mtimeMs: st.mtimeMs, name: meta.name, description: meta.description,
    })
  }
  return out
}

async function scanRoot(tier: SkillRootPlanEntry): Promise<SkillIndexRecord[]> {
  if (usingTestIo) return scanRootWithIo(tier)
  try {
    return await getWorkerPool().run('skills.scanRoot', {
      root: tier.root,
      source: tier.source,
      excludeRoot: tier.excludeAppManaged ? APP_MANAGED_SKILLS_DIR : undefined,
    })
  } catch {
    return scanRootWithIo(tier)
  }
}

async function refreshPlan(plan: SkillRootPlanEntry[]): Promise<void> {
  const seen = new Set<string>()
  const changed: string[] = []
  const removed: string[] = []
  for (const tier of plan) {
    const names = await io.readdir(tier.root)
    for (const name of names) {
      if (!isSafeSkillName(name)) continue
      const dir = join(tier.root, name)
      seen.add(dir)
      const headPath = join(dir, 'SKILL.md')
      const st = await io.stat(headPath)
      if (!st?.isFile) continue
      const existing = records.get(dir)
      if (existing && existing.mtimeMs === st.mtimeMs && existing.size === st.size) continue
      const text = await io.readFile(headPath)
      const meta = parseHead(text, name)
      if (!meta) continue
      records.set(dir, {
        path: dir, slug: name, source: tier.source, root: tier.root,
        size: st.size, mtimeMs: st.mtimeMs, name: meta.name, description: meta.description,
      })
      changed.push(name)
    }
  }
  for (const [path, record] of records) {
    if (!seen.has(path) && plan.some((tier) => record.root === tier.root)) {
      records.delete(path)
      removed.push(record.slug)
    }
  }
  if (changed.length || removed.length) emitSoon(changed, removed)
}

export async function ensureSkillIndex(workspaceRoot: string, projectRoot?: string): Promise<void> {
  if (!snapshotLoaded) await loadSnapshot()
  const plan = getSkillRootPlan(workspaceRoot, projectRoot)
  if (records.size === 0) {
    const cold = await Promise.all(plan.map((tier) => scanRoot(tier)))
    for (const batch of cold) for (const row of batch) records.set(row.path, row)
    revision++
    await saveSnapshot()
    return
  }
  await refreshPlan(plan)
}

export async function querySkills(args: SkillsQueryArgs): Promise<SkillsQueryResult> {
  await ensureSkillIndex(args.workspaceRoot, args.projectRoot)
  const planRoots = new Set(getSkillRootPlan(args.workspaceRoot, args.projectRoot).map((tier) => tier.root))
  const needle = args.query?.trim().toLocaleLowerCase() ?? ''
  const sources = args.sources ? new Set(args.sources) : null
  const slugs = args.slugs ? new Set(args.slugs) : null
  let items = [...records.values()].filter((row) => planRoots.has(row.root))
  if (sources) items = items.filter((row) => sources.has(row.source))
  if (slugs) items = items.filter((row) => slugs.has(row.slug))
  if (needle) {
    items = items.filter((row) =>
      row.slug.toLocaleLowerCase().includes(needle)
      || row.name.toLocaleLowerCase().includes(needle)
      || row.description.toLocaleLowerCase().includes(needle))
  }
  const total = items.length
  const offset = Math.max(0, args.offset ?? 0)
  const limit = Math.min(SKILLS_QUERY_LIMIT_CAP, Math.max(1, args.limit ?? 50))
  return {
    items: items.slice(offset, offset + limit).map(toSummary),
    total,
    revision,
  }
}

export async function markSkillIndexDirty(skillDir: string): Promise<void> {
  const headPath = join(skillDir, 'SKILL.md')
  const st = await io.stat(headPath)
  const slug = skillDir.split(/[\\/]/).pop() ?? skillDir
  if (!st?.isFile) {
    if (records.delete(skillDir)) emitSoon([], [slug])
    return
  }
  const text = await io.readFile(headPath)
  const meta = parseHead(text, slug)
  if (!meta) return
  const existing = records.get(skillDir)
  records.set(skillDir, {
    path: skillDir,
    slug,
    source: existing?.source ?? 'workspace',
    root: existing?.root ?? skillDir,
    size: st.size,
    mtimeMs: st.mtimeMs,
    name: meta.name,
    description: meta.description,
  })
  emitSoon([slug], [])
}

export function indexedSkillSummaries(): LoadedSkill[] {
  return [...records.values()].map(toSummary)
}
