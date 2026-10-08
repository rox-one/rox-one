/**
 * W1-08 (#1505) — axe-core checks for every story (mounted in happy-dom).
 * Colour contrast is excluded (needs real CSS); everything else must pass.
 */
import { axeViolations, describeViolations, mount, resetDom } from './test-env'
import { afterEach, describe, expect, it } from 'bun:test'
import { ContextualDatePicker, PersonField, SubscribersPicker } from '@rox/ui/primitives'
import { entityPrimitiveComponents, FIXTURE_PEOPLE, FIXTURE_TODAY } from '@/playground/registry/entity-primitives'
import { EntityPicker } from '../EntityPicker'

afterEach(() => { resetDom() })

describe('W1-08 stories have no axe violations', () => {
  for (const entry of entityPrimitiveComponents) {
    const variants = entry.variants?.length ? entry.variants : [{ name: 'default', props: {} }]
    for (const variant of variants) {
      for (const lang of ['ru', 'en'] as const) {
        it(`${entry.id} / ${variant.name} / ${lang}`, async () => {
          const defaults = Object.fromEntries(entry.props.map((prop) => [prop.name, prop.defaultValue]))
          const Component = entry.component
          const mounted = await mount(<main><Component {...defaults} {...variant.props} /></main>, { lang })
          const violations = await axeViolations(mounted.container)
          await mounted.unmount()
          expect(describeViolations(violations)).toBe('')
        })
      }
    }
  }

  const OPEN_STATES: Array<[string, () => JSX.Element]> = [
    ['PersonField open', () => <PersonField role="champion" person={null} candidates={FIXTURE_PEOPLE} defaultOpen />],
    ['SubscribersPicker open', () => <SubscribersPicker people={FIXTURE_PEOPLE} subscriberIds={['p1']} defaultOpen />],
    ['ContextualDatePicker open', () => <ContextualDatePicker value={{ precision: 'day', date: '2026-10-08' }} today={FIXTURE_TODAY} defaultOpen />],
    ['EntityPicker dialog open', () => <EntityPicker open onOpenChange={() => {}} workspaceId="ws" initialQuery="task:42" onSelect={() => {}} />],
  ]
  for (const [name, render] of OPEN_STATES) {
    it(`${name} (portal content included)`, async () => {
      const mounted = await mount(<main>{render()}</main>)
      const violations = await axeViolations(document.body)
      const portalText = document.body.textContent ?? ''
      await mounted.unmount()
      expect(portalText.length).toBeGreaterThan(0)
      expect(describeViolations(violations)).toBe('')
    })
  }

  it('axe itself detects a real violation (negative control)', async () => {
    const mounted = await mount(<main><button type="button" /><img src="x.png" /></main>)
    const violations = await axeViolations(mounted.container)
    await mounted.unmount()
    expect(violations.map((v) => v.id)).toEqual(expect.arrayContaining(['button-name', 'image-alt']))
  })
})
