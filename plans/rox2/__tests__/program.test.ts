import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ROX2_ENTITY_KINDS,
  soupTypeToRox2Kind,
} from '../../../packages/core/src/rox2/platform-contract.ts'
import type { SoupEntityConcreteType } from '../../../packages/core/src/conation/soup/types.ts'
import { ROX2_CONATION_GAPS, ROX2_SCREENS, ROX2_SERVICES } from '../inventory.ts'
import { buildRox2Cards } from '../registry.ts'
import { ROX2_DOMAINS, ROX2_EVIDENCE } from '../schema.ts'

const ROOT = join(import.meta.dir, '../../..')
const ALL_SOUP_TYPES: SoupEntityConcreteType[] = [
  'GraphqlSoupDocument',
  'GraphqlSoupChat',
  'GraphqlSoupProject',
  'GraphqlSoupEmailThread',
  'GraphqlSoupChannel',
  'GraphqlSoupChannelMessage',
  'GraphqlSoupCall',
  'GraphqlSoupCalendarEvent',
  'GraphqlSoupCrmCompany',
  'GraphqlSoupForeignEntity',
  'GraphqlSoupReminder',
]

describe('ROX2 program artifacts (#315)', () => {
  const cards = buildRox2Cards()

  test('has exactly 200 unique cards ROX2-001..200', () => {
    expect(cards).toHaveLength(200)
    expect(cards.map((card) => card.id)).toEqual(
      Array.from({ length: 200 }, (_, i) => `ROX2-${String(i + 1).padStart(3, '0')}`),
    )
    expect(new Set(cards.map((card) => card.title)).size).toBe(200)
  })

  test('every card has required fields and open status', () => {
    for (const card of cards) {
      expect(card.status).toBe('open')
      expect(card.title.length).toBeGreaterThan(8)
      expect(card.asIs.length).toBeGreaterThan(12)
      expect(card.toBe.length).toBeGreaterThan(12)
      expect(card.files.length).toBeGreaterThan(0)
      expect(card.plan.length).toBeGreaterThan(0)
      expect(card.acceptance.length).toBeGreaterThan(0)
      expect(card.tests.length).toBeGreaterThan(0)
      expect(card.rollback.length).toBeGreaterThan(4)
      expect(ROX2_EVIDENCE).toContain(card.evidence)
      expect(ROX2_DOMAINS).toContain(card.domain)
    }
  })

  test('every listed file exists', () => {
    const missing: string[] = []
    for (const card of cards) {
      for (const file of card.files) {
        if (!existsSync(join(ROOT, file))) missing.push(`${card.id}:${file}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('screen and service inventories point at existing files', () => {
    for (const record of [...ROX2_SCREENS, ...ROX2_SERVICES]) {
      expect(record.files.length).toBeGreaterThan(0)
      for (const file of record.files) {
        expect(existsSync(join(ROOT, file))).toBe(true)
      }
    }
  })

  test('gap matrix covers every Soup concrete type plus DSS/Board/Fund/flags', () => {
    const ids = new Set(ROX2_CONATION_GAPS.map((row) => row.id))
    for (const type of ALL_SOUP_TYPES) {
      expect(ids.has(type)).toBe(true)
      expect(ROX2_ENTITY_KINDS).toContain(soupTypeToRox2Kind(type))
    }
    expect(ids.has('dss-drive')).toBe(true)
    expect(ids.has('board-deeplink')).toBe(true)
    expect(ids.has('fund-deeplink')).toBe(true)
    expect(ids.has('shell-flags')).toBe(true)
  })

  test('emitted JSON matches the TypeScript registry', () => {
    const registry = JSON.parse(readFileSync(join(ROOT, 'plans/rox2/registry.json'), 'utf8')) as {
      cardCount: number
      cards: Array<{ id: string; title: string }>
    }
    expect(registry.cardCount).toBe(200)
    expect(registry.cards.map((card) => card.id)).toEqual(cards.map((card) => card.id))
    expect(registry.cards.map((card) => card.title)).toEqual(cards.map((card) => card.title))
  })

  test('README names constraints and forbids PR-count readiness', () => {
    const readme = readFileSync(join(ROOT, 'plans/rox2/README.md'), 'utf8')
    expect(readme).toContain('da4643517e61a9b4e9c958567441acf3541b09af')
    expect(readme).toContain('Do not infer product readiness from the number of merged PRs')
    expect(readme).toContain('does **not** claim')
    expect(readme).toContain('apps/electron/src/transport/index.ts')
    expect(readme).toContain('Bugfixes are separate PRs')
    expect(existsSync(join(ROOT, 'LICENSE'))).toBe(true)
    expect(existsSync(join(ROOT, 'NOTICE'))).toBe(true)
  })
})
