#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROX2_CONATION_GAPS, ROX2_SCREENS, ROX2_SERVICES } from './inventory.ts'
import { buildRox2Cards } from './registry.ts'

const dir = import.meta.dir
mkdirSync(dir, { recursive: true })

const cards = buildRox2Cards()
const payload = {
  issue: 315,
  id: 'ROX2-000',
  shipRef: 'da4643517e61a9b4e9c958567441acf3541b09af',
  generatedFrom: 'plans/rox2/registry.ts',
  cardCount: cards.length,
  cards,
}

writeFileSync(join(dir, 'registry.json'), `${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(
  join(dir, 'inventory.json'),
  `${JSON.stringify({ screens: ROX2_SCREENS, services: ROX2_SERVICES }, null, 2)}\n`,
)
writeFileSync(
  join(dir, 'conation-gap-matrix.json'),
  `${JSON.stringify({ rows: ROX2_CONATION_GAPS }, null, 2)}\n`,
)

console.log(`wrote ${cards.length} cards`)
