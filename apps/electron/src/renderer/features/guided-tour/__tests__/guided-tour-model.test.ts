import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GUIDED_TOUR_START_EVENT, GUIDED_TOUR_STEPS, GUIDED_TOUR_VERSION, findShowableIndex, isUsableRect, parseGuidedTourRecord,
  legacyTourInvitationAllowed, placeCard, requestGuidedTour, resolveStepRect, shouldAutoStartGuidedTour,
} from '../model'

const vp = { width: 1280, height: 800 }
const box = { left: 10, top: 10, width: 100, height: 40 }

describe('guided tour model', () => {
  it('auto-starts until the current version is completed or skipped', () => {
    expect(shouldAutoStartGuidedTour(null)).toBe(true)
    expect(shouldAutoStartGuidedTour({ status: 'weird', version: 1 })).toBe(true)
    expect(shouldAutoStartGuidedTour({ status: 'completed', version: GUIDED_TOUR_VERSION })).toBe(false)
    expect(shouldAutoStartGuidedTour({ status: 'skipped', version: GUIDED_TOUR_VERSION })).toBe(false)
    expect(shouldAutoStartGuidedTour({ status: 'completed', version: GUIDED_TOUR_VERSION - 1 })).toBe(true)
    expect(parseGuidedTourRecord({ status: 'skipped', version: 1 })).toEqual({ status: 'skipped', version: 1, at: 0 })
  })

  it('rejects empty and off-screen rects', () => {
    expect(isUsableRect(null, vp)).toBe(false)
    expect(isUsableRect({ ...box, width: 0 }, vp)).toBe(false)
    expect(isUsableRect({ ...box, left: 2000 }, vp)).toBe(false)
    expect(isUsableRect(box, vp)).toBe(true)
  })

  it('resolves the first visible selector, centres target-less steps, flags missing ones', () => {
    const step = { id: 's', selectors: ['#a', '#b'], titleKey: '', bodyKey: '' }
    expect(resolveStepRect(step, sel => sel === '#b' ? box : null, vp)).toEqual(box)
    expect(resolveStepRect(step, () => null, vp)).toBeNull()
    expect(resolveStepRect({ ...step, selectors: [] }, () => null, vp)).toBeUndefined()
  })

  it('skips steps with missing targets in both directions', () => {
    const steps = ['a', 'b', 'c', 'd'].map(id => ({ id, selectors: [], titleKey: '', bodyKey: '' }))
    const ok = (s: { id: string }) => s.id !== 'b' && s.id !== 'c'
    expect(findShowableIndex(steps, 1, 1, ok)).toBe(3)
    expect(findShowableIndex(steps, 2, -1, ok)).toBe(0)
    expect(findShowableIndex(steps, 4, 1, ok)).toBe(-1)
    expect(findShowableIndex(steps, -1, -1, ok)).toBe(-1)
  })

  it('places the card beside, below or centred and inside the viewport', () => {
    const card = { width: 320, height: 180 }
    expect(placeCard(undefined, card, vp).side).toBe('center')
    expect(placeCard({ left: 0, top: 100, width: 240, height: 400 }, card, vp)).toMatchObject({ side: 'right', left: 252 })
    const wide = placeCard({ left: 300, top: 0, width: 700, height: 40 }, card, vp)
    expect(wide.side).toBe('bottom')
    const corner = placeCard({ left: 1200, top: 760, width: 60, height: 30 }, card, vp)
    expect(corner.left + card.width).toBeLessThanOrEqual(vp.width)
    expect(corner.top).toBeGreaterThanOrEqual(0)
  })

  it('dispatches the start event', () => {
    const events: string[] = []
    requestGuidedTour({ dispatchEvent: (e: Event) => { events.push(e.type); return true } })
    expect(events).toEqual([GUIDED_TOUR_START_EVENT])
  })

  it('covers the key UI with data-tour targets first', () => {
    const ids = GUIDED_TOUR_STEPS.map(s => s.id)
    for (const id of ['navigation', 'tools', 'pills', 'agent', 'new-chat', 'composer', 'cloud', 'search', 'profile']) expect(ids).toContain(id)
    for (const step of GUIDED_TOUR_STEPS) if (step.selectors.length) expect(step.selectors[0]).toStartWith('[data-tour="guide.')
  })

  it('has every string in all 12 locales', () => {
    const dir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
    const keys = ['guidedTour.counter', 'guidedTour.close', 'guidedTour.skip', 'guidedTour.back', 'guidedTour.next', 'guidedTour.done', 'guidedTour.relaunch',
      ...GUIDED_TOUR_STEPS.flatMap(s => [s.titleKey, s.bodyKey])]
    for (const locale of ['en', 'ru', 'de', 'es', 'fr', 'hu', 'ja', 'ko', 'pl', 'zh-Hans', 'zh-Hant', 'ar']) {
      const messages = JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8')) as Record<string, string>
      for (const key of keys) expect(typeof messages[key] === 'string' && messages[key]!.length > 0, `${locale}:${key}`).toBe(true)
      expect(messages['guidedTour.counter']).toContain('{{current}}')
      expect(messages['guidedTour.counter']).toContain('{{total}}')
    }
  })

  it('legacy invitations only after the guided tour was skipped', () => {
    expect(legacyTourInvitationAllowed(null)).toBe(false)
    expect(legacyTourInvitationAllowed({ status: 'completed', version: GUIDED_TOUR_VERSION })).toBe(false)
    expect(legacyTourInvitationAllowed({ status: 'skipped', version: GUIDED_TOUR_VERSION })).toBe(true)
  })
})
