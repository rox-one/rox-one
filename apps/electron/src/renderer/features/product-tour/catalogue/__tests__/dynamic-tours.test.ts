import { beforeEach, describe, expect, test } from 'bun:test'
import type { DynamicTourId, StepId, TargetId, TourBinding, TourDefinition } from '../../contracts'
import {
  clearDynamicTours, createDynamicTourSource, dynamicTourId, getDynamicTour, listDynamicTours,
  registerDynamicTour, subscribeDynamicTours, unregisterDynamicTour,
} from '../dynamic'
import { validateDynamicTourCatalogue } from '../validate'
import { productTourCatalogue, validateProductTourCatalogue } from '../index'
import { resolveTourRoute } from '../../runtime/routes'
import { devSpaceTour } from './fixtures/dynamic-tour'

const binding: TourBinding = { workspaceId: 'workspace', panelId: 'panel', sessionId: 'session', clientProfileId: 'profile', runToken: 'run' }

// Generated ids come from the canonical helper: `DS-…-n` / `PB-…-n` literals do not match the template-literal id type on their own.
const repoOverviewId = dynamicTourId('DS', 'repo-overview', 1)
const knowledgeTourId = dynamicTourId('PB', 'knowledge-tour', 2)

beforeEach(() => clearDynamicTours())

describe('TOUR-DYN dynamic catalogue source (D9)', () => {
  test('TOUR-DYN-01 admits a valid generated tour into the shared engine source', () => {
    const registration = registerDynamicTour(devSpaceTour())
    expect(registration.id).toBe(repoOverviewId)
    expect(registration.errors).toEqual([])
    expect(getDynamicTour(repoOverviewId)).toBeDefined()
    expect(listDynamicTours().map(tour => tour.id)).toEqual([repoOverviewId])
    const snapshot = listDynamicTours()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(listDynamicTours()).toBe(snapshot)
    let notifications = 0
    const unsubscribe = subscribeDynamicTours(() => { notifications += 1 })
    registration.cleanup()
    expect(notifications).toBe(1)
    expect(listDynamicTours()).toEqual([])
    unsubscribe()
    unregisterDynamicTour(repoOverviewId)
    expect(notifications).toBe(1)
  })

  test('TOUR-DYN-02 rejects invalid generated tours without admitting them', () => {
    const invalid = devSpaceTour({ id: 'OBT-01' as TourDefinition['id'] })
    const registration = registerDynamicTour(invalid)
    expect(registration.id).toBeNull()
    expect(registration.errors.length).toBeGreaterThan(0)
    expect(listDynamicTours()).toEqual([])
  })

  test('TOUR-DYN-03 a stale cleanup never removes a replacement registration', () => {
    const first = registerDynamicTour(devSpaceTour())
    const replacement = registerDynamicTour(devSpaceTour())
    expect(first.id).toBe(repoOverviewId)
    first.cleanup()
    expect(replacement.id).toBe(repoOverviewId)
    expect(getDynamicTour(repoOverviewId)).toBeDefined()
    replacement.cleanup()
    expect(getDynamicTour(repoOverviewId)).toBeUndefined()
  })

  test('TOUR-DYN-04 generated tours use the reserved dynamic id and step spaces', () => {
    const source = createDynamicTourSource()
    expect(source.register(devSpaceTour()).errors).toEqual([])
    const playbooks = devSpaceTour({
      id: knowledgeTourId,
      slug: 'knowledge-tour',
      entryTriggers: ['playbooks-opened'],
      titleKey: 'productTour.knowledge-tour.name',
      goalKey: 'productTour.knowledge-tour.goal',
      whyKey: 'productTour.knowledge-tour.why',
      requires: ['playbooks.available'],
      steps: [{ ...devSpaceTour().steps[0]!, id: 'playbooks.sources.list' as StepId, target: 'playbooks.sources.list' as TargetId, routeKey: 'playbooks-source', copyKey: 'productTour.knowledge-tour.playbooks.sources.list.', testId: 'T-PLAYBOOKS-SOURCES' }],
    })
    expect(source.register(playbooks).errors).toEqual([])
    expect(source.list().map(tour => tour.id).sort()).toEqual([repoOverviewId, knowledgeTourId])
  })

  test('TOUR-DYN-05 dynamic validation stays separate from the pinned static catalogue', () => {
    expect(validateDynamicTourCatalogue([devSpaceTour()])).toEqual([])
    expect(validateDynamicTourCatalogue([devSpaceTour({ id: 'DS-repo-overview' as TourDefinition['id'] })])).toContain('catalogue[0].id: unknown identifier')
    expect(validateDynamicTourCatalogue([devSpaceTour({ steps: [] })])).toContain('catalogue[0].steps: expected ordered steps')
    expect(validateProductTourCatalogue()).toEqual([])
    expect(productTourCatalogue).toHaveLength(25)
  })

  test('TOUR-DYN-06 generated tours reach the dev-space and Playbooks routes', () => {
    expect(resolveTourRoute('devspace', binding)).toBe('developers')
    expect(resolveTourRoute('devspace-repo', { ...binding, entityId: 'repo-1' })).toBe('developers?repo=repo-1')
    expect(resolveTourRoute('playbooks', binding)).toBe('playbooks')
    expect(resolveTourRoute('playbooks-source', binding)).toBe('playbooks')
    expect(resolveTourRoute('playbooks-codebook', binding)).toBe('playbooks')
  })

  test('TOUR-DYN-07 the canonical id generator produces the reserved shape', () => {
    expect(dynamicTourId('DS', 'repo-overview', 3)).toBe('DS-repo-overview-3' as DynamicTourId)
    expect(dynamicTourId('PB', 'podcast', 1)).toBe('PB-podcast-1' as DynamicTourId)
  })
})