import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  COLLECTION_FILTERS_RELATIVE_PATH,
  getCollectionFiltersPath,
  loadCollectionFiltersMap,
  normalizeCollectionFilters,
  normalizeCollectionFiltersMap,
  saveCollectionFiltersMap,
} from '../collection-filters-storage.ts'
import type { CollectionFilters } from '../collection-types.ts'

let tempDir: string
let workspaceRoot: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'collection-filters-'))
  workspaceRoot = join(tempDir, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
})

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('normalizeCollectionFilters', () => {
  it('returns empty filters for null/non-object', () => {
    expect(normalizeCollectionFilters(null)).toEqual({})
    expect(normalizeCollectionFilters('x')).toEqual({})
    expect(normalizeCollectionFilters(42)).toEqual({})
  })

  it('keeps valid fields and drops invalid ones', () => {
    const normalized = normalizeCollectionFilters({
      status: ['todo', 'done', 42, 'todo'],
      priority: ['urgent', 'bogus', 'low'],
      projectId: ['p1', null, 'p2'],
      labels: 'not-an-array',
      flagged: true,
      hasUnread: 'yes',
      model: ['kimi-K3'],
      unknownField: 'dropped',
    })
    expect(normalized).toEqual({
      status: ['todo', 'done'],
      priority: ['urgent', 'low'],
      projectId: ['p1', 'p2'],
      flagged: true,
      model: ['kimi-K3'],
    })
  })

  it('validates due ranges by discriminator', () => {
    expect(normalizeCollectionFilters({ due: { type: 'overdue' } }).due).toEqual({ type: 'overdue' })
    expect(normalizeCollectionFilters({ due: { type: 'today' } }).due).toEqual({ type: 'today' })
    expect(normalizeCollectionFilters({ due: { type: 'none' } }).due).toEqual({ type: 'none' })
    expect(
      normalizeCollectionFilters({ due: { type: 'next_n_days', days: 5 } }).due,
    ).toEqual({ type: 'next_n_days', days: 5 })
    expect(
      normalizeCollectionFilters({ due: { type: 'range', start: 100, end: 200 } }).due,
    ).toEqual({ type: 'range', start: 100, end: 200 })
    // invalid shapes dropped
    expect(normalizeCollectionFilters({ due: { type: 'next_n_days', days: 'five' } }).due).toBeUndefined()
    expect(normalizeCollectionFilters({ due: { type: 'range', start: 100 } }).due).toBeUndefined()
    expect(normalizeCollectionFilters({ due: { type: 'someday' } }).due).toBeUndefined()
    expect(normalizeCollectionFilters({ due: 'overdue' }).due).toBeUndefined()
  })

  it('drops empty array dimensions (equivalent to no chip)', () => {
    expect(normalizeCollectionFilters({ status: [], priority: [] })).toEqual({})
  })
})

describe('normalizeCollectionFiltersMap', () => {
  it('returns empty map for null/non-object', () => {
    expect(normalizeCollectionFiltersMap(null)).toEqual({})
    expect(normalizeCollectionFiltersMap([])).toEqual({})
  })

  it('accepts the on-disk envelope shape', () => {
    const map = normalizeCollectionFiltersMap({
      version: 1,
      filtersByKey: {
        allSessions: { status: ['todo'] },
        'label:abc': { labels: ['abc'] },
      },
    })
    expect(map).toEqual({
      allSessions: { status: ['todo'] },
      'label:abc': { labels: ['abc'] },
    })
  })

  it('accepts a bare map shape (no envelope) and drops invalid entries', () => {
    const map = normalizeCollectionFiltersMap({
      allSessions: { status: ['todo'] },
      broken: 'nope',
      '': { status: ['done'] },
    })
    expect(map).toEqual({ allSessions: { status: ['todo'] } })
  })
})

describe('loadCollectionFiltersMap / saveCollectionFiltersMap', () => {
  it('loads empty map when file is missing (defaults, not written)', () => {
    expect(loadCollectionFiltersMap(workspaceRoot)).toEqual({})
    expect(existsSync(getCollectionFiltersPath(workspaceRoot))).toBe(false)
  })

  it('loads empty map when file is corrupt', () => {
    const path = getCollectionFiltersPath(workspaceRoot)
    mkdirSync(join(workspaceRoot, 'collection'), { recursive: true })
    writeFileSync(path, '{not-json')
    expect(loadCollectionFiltersMap(workspaceRoot)).toEqual({})
  })

  it('round-trips per-key filters through collection/filters.json', () => {
    const input: Record<string, CollectionFilters> = {
      allSessions: { status: ['todo', 'in-progress'], flagged: true },
      'view:linear': { priority: ['urgent'], due: { type: 'today' } },
    }
    const saved = saveCollectionFiltersMap(workspaceRoot, input)
    expect(saved).toEqual(input)

    const path = join(workspaceRoot, COLLECTION_FILTERS_RELATIVE_PATH)
    expect(existsSync(path)).toBe(true)
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    expect(raw).toEqual({ version: 1, filtersByKey: input })
    expect(loadCollectionFiltersMap(workspaceRoot)).toEqual(input)
  })

  it('normalizes on save', () => {
    const saved = saveCollectionFiltersMap(workspaceRoot, {
      allSessions: { status: ['todo', 'todo', 7 as never], priority: ['nope' as never] },
    })
    expect(saved).toEqual({ allSessions: { status: ['todo'] } })
    expect(loadCollectionFiltersMap(workspaceRoot)).toEqual({ allSessions: { status: ['todo'] } })
  })
})
