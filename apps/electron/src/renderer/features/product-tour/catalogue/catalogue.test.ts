import { describe, expect, test } from 'bun:test'
import type { TourId } from '../contracts'
import { productTourCatalogue, tourCatalogue, validateProductTourCatalogue } from './index'

const clone = () => structuredClone(productTourCatalogue)

describe('full product learning catalogue', () => {
  test('keeps all 25 pinned IDs, 56 unique steps and test IDs', () => {
    expect(productTourCatalogue.map(tour => tour.id)).toEqual(Array.from({ length: 25 }, (_, i) => `OBT-${String(i + 1).padStart(2, '0')}` as TourId))
    const steps = productTourCatalogue.flatMap(tour => tour.steps)
    expect(steps).toHaveLength(56)
    expect(new Set(steps.map(step => step.id)).size).toBe(56)
    expect(new Set(steps.map(step => step.testId)).size).toBe(56)
    expect(tourCatalogue).toBe(productTourCatalogue)
    expect(validateProductTourCatalogue()).toEqual([])
  })
  test('preserves first result and source use evidence policies', () => {
    const first = productTourCatalogue[0]!
    expect(first.steps).toHaveLength(6)
    expect(first.steps[5]!.completion).toEqual({ kind: 'signal', signal: 'user-turn.final-delivered', evidence: 'verified', priorState: 'same-attempt', requireAcknowledgementAfterEvidence: true })
    expect(productTourCatalogue[7]!.version).toBe(2)
    expect(productTourCatalogue[7]!.steps[2]!.version).toBe(2)
    expect(productTourCatalogue[7]!.steps[2]!.completion).toEqual({ kind: 'signal', signal: 'source.tool-succeeded', evidence: 'verified', priorState: 'same-attempt', requireAcknowledgementAfterEvidence: true })
    expect(productTourCatalogue[7]!.steps.map(step => step.completion.signal)).toEqual(['session.sources-committed', 'user-turn.accepted', 'source.tool-succeeded'])
    expect(productTourCatalogue.flatMap(t => t.steps).filter(s => s.optional).map(s => s.id)).toEqual(['workflow.label', 'tasks.delegate', 'memory.save', 'meetings.result'])
  })
  test('is deeply immutable and purely declarative', () => {
    const visit = (value: unknown): void => {
      expect(typeof value).not.toBe('function')
      if (value && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true)
        for (const item of Object.values(value)) visit(item)
      }
    }
    visit(productTourCatalogue)
  })
  test('rejects missing coverage, duplicate IDs, unknown routes and capabilities', () => {
    expect(validateProductTourCatalogue([]).length).toBeGreaterThan(0)
    for (const [key, value] of [['id', 'OBT-99'], ['requires', ['oauth.grant']], ['entryTriggers', ['auto-run']]]) {
      const data: any = clone(); data[0][key as string] = value
      expect(validateProductTourCatalogue(data).length).toBeGreaterThan(0)
    }
    const duplicate: any = clone(); duplicate[1].steps[0].id = duplicate[0].steps[0].id
    expect(validateProductTourCatalogue(duplicate).some(error => error.includes('duplicate'))).toBe(true)
    const route: any = clone(); route[0].steps[0].routeKey = 'send-message'
    expect(validateProductTourCatalogue(route).length).toBeGreaterThan(0)
  })
  test('rejects executable, unsafe, malformed and weakened completion data', () => {
    const mutations: ((data: any) => void)[] = [
      data => { data[0].steps[0].execute = () => undefined },
      data => { data[0].steps[0].copyKey = 'other.namespace.' },
      data => { data[0].steps[0].target = 'unknown' },
      data => { data[0].steps[0].completion.evidence = 'acknowledged' },
      data => { data[0].steps[0].onUnavailable = 'not-applicable' },
      data => { data[0].steps[0].copy.en.body = '' },
    ]
    for (const mutation of mutations) {
      const data = clone(); mutation(data)
      expect(validateProductTourCatalogue(data).length).toBeGreaterThan(0)
    }
    expect(validateProductTourCatalogue(null).length).toBeGreaterThan(0)
  })
})
