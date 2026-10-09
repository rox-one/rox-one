/**
 * PERF-10 (#1577): the memoized route preloader — one import per chunk, a
 * failed attempt stays retryable — and the registry contract the warm-up and
 * the rail prefetch rely on.
 */
import { describe, expect, it } from 'bun:test'
import { createRoutePreloader } from '../route-preload'
import { RAIL_SURFACE_ROUTES, ROUTE_PAGE_NAMES, ROUTE_PAGE_LOADERS } from '../../components/app-shell/route-pages'

describe('createRoutePreloader', () => {
  it('loads a route once and shares the promise with later callers', async () => {
    const calls: string[] = []
    const preloader = createRoutePreloader({
      notes: async () => { calls.push('notes'); return { default: 'Notes' } },
      tasks: async () => { calls.push('tasks'); return { default: 'Tasks' } },
    })
    const first = preloader.preload('notes')
    const second = preloader.preload('notes')
    expect(second).toBe(first)
    await Promise.all([first, second, preloader.preload('tasks')])
    expect(calls).toEqual(['notes', 'tasks'])
    expect(preloader.preloaded()).toEqual(['notes', 'tasks'])
  })

  it('keeps a failed chunk retryable instead of caching the rejection', async () => {
    let attempts = 0
    const preloader = createRoutePreloader({
      notes: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('chunk offline')
        return { default: 'Notes' }
      },
    })
    await expect(preloader.preload('notes')).rejects.toThrow('chunk offline')
    expect(preloader.failed()).toEqual(['notes'])
    await preloader.preload('notes')
    expect(attempts).toBe(2)
    expect(preloader.failed()).toEqual([])
  })
})

describe('route registry', () => {
  it('registers a loader for every rail surface', () => {
    for (const name of RAIL_SURFACE_ROUTES) {
      expect(typeof ROUTE_PAGE_LOADERS[name]).toBe('function')
      expect(ROUTE_PAGE_NAMES).toContain(name)
    }
  })
})