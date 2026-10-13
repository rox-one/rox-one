/**
 * Renderer-side paging for the skills catalog (ADR-0023 §7, #1866).
 * Surfaces MUST ask `skills:query` for a page, never `skills.GET` for the
 * whole catalog. A 10k-skill folder must not be held or rendered here.
 */
import type { LoadedSkill } from '../../shared/types'

export const SKILLS_UI_PAGE_SIZE = 80
export const SKILLS_UI_SEARCH_LIMIT = 50
export const SKILLS_UI_ACCUMULATE_CAP = 500
export const SKILLS_UI_QUERY_DEBOUNCE_MS = 120

export interface SkillsQueryPage {
  items: LoadedSkill[]
  total: number
  revision: number
}

export interface SkillsChangedDelta {
  revision: number
  changed: string[]
  removed: string[]
}

export interface SkillsQueryRequest {
  workspaceId: string
  workingDirectory?: string
  query?: string
  offset?: number
  limit?: number
  sources?: Array<'omp' | 'global' | 'workspace' | 'project'>
  slugs?: string[]
}

export interface SkillsQueryApi {
  querySkills?(args: SkillsQueryRequest): Promise<SkillsQueryPage>
  getSkills?(workspaceId: string, workingDirectory?: string): Promise<LoadedSkill[]>
}

const EMPTY_PAGE: SkillsQueryPage = { items: [], total: 0, revision: 0 }

export function emptySkillsQueryPage(): SkillsQueryPage {
  return EMPTY_PAGE
}

export function capSkillsLimit(limit: number | undefined, cap = SKILLS_UI_ACCUMULATE_CAP): number {
  const n = limit ?? SKILLS_UI_PAGE_SIZE
  return Math.min(cap, Math.max(1, n))
}

/** Missed coalesced events: don't patch a stale window. */
export function shouldRefetchSkillsPage(currentRevision: number, delta: SkillsChangedDelta): boolean {
  if (currentRevision <= 0) return true
  return delta.revision > currentRevision + 1
}

function matchesQuery(skill: LoadedSkill, query: string): boolean {
  if (!query) return true
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return skill.slug.toLocaleLowerCase().includes(needle)
    || skill.metadata.name.toLocaleLowerCase().includes(needle)
    || skill.metadata.description.toLocaleLowerCase().includes(needle)
}

/**
 * Patch a visible page from a `skills:changed` delta. `fetchedChanged` is the
 * result of `querySkills({ slugs: delta.changed })` (empty when nothing changed).
 * Never grows past `cap`. Total is adjusted by visible add/remove only; a
 * revision gap must refetch instead of calling this.
 */
export function applySkillsChangedDelta(args: {
  page: SkillsQueryPage
  delta: SkillsChangedDelta
  fetchedChanged: readonly LoadedSkill[]
  query?: string
  cap?: number
}): SkillsQueryPage {
  const cap = args.cap ?? SKILLS_UI_ACCUMULATE_CAP
  const removed = new Set(args.delta.removed)
  const query = args.query ?? ''
  const fetched = args.fetchedChanged.filter((skill) => matchesQuery(skill, query) && !removed.has(skill.slug))
  const bySlug = new Map(fetched.map((skill) => [skill.slug, skill]))
  const items: LoadedSkill[] = []
  const seen = new Set<string>()
  let removedVisible = 0
  for (const skill of args.page.items) {
    if (removed.has(skill.slug)) {
      removedVisible++
      continue
    }
    const next = bySlug.get(skill.slug) ?? skill
    items.push(next)
    seen.add(skill.slug)
  }
  let added = 0
  for (const skill of fetched) {
    if (seen.has(skill.slug)) continue
    if (items.length >= cap) break
    items.push(skill)
    seen.add(skill.slug)
    added++
  }
  return {
    items,
    total: Math.max(0, args.page.total - removedVisible + added),
    revision: args.delta.revision,
  }
}

/**
 * Page the catalog through `querySkills` when the preload exposes it; otherwise
 * slice a legacy `getSkills` list so tests without the new channel still run.
 * Production always has `querySkills`.
 */
export async function readSkillsPage(
  api: SkillsQueryApi | undefined,
  request: SkillsQueryRequest,
): Promise<SkillsQueryPage> {
  const limit = capSkillsLimit(request.limit)
  const offset = Math.max(0, request.offset ?? 0)
  if (api?.querySkills) {
    return api.querySkills({ ...request, offset, limit })
  }
  if (!api?.getSkills) return { items: [], total: 0, revision: 0 }
  const all = await api.getSkills(request.workspaceId, request.workingDirectory)
  const needle = request.query?.trim().toLocaleLowerCase() ?? ''
  const slugs = request.slugs ? new Set(request.slugs) : null
  const sources = request.sources ? new Set(request.sources) : null
  const filtered = all.filter((skill) => {
    if (skill.shadowedByCraft) return false
    if (slugs && !slugs.has(skill.slug)) return false
    if (sources && !sources.has(skill.source)) return false
    if (needle && !matchesQuery(skill, needle)) return false
    return true
  })
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    revision: 0,
  }
}
