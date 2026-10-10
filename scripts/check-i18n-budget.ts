#!/usr/bin/env bun
/**
 * check-i18n-budget.ts — hard ceiling for the English string catalogue (02 §11, O11).
 *
 * O11 closed 2026-10-10: every user-facing string lands in all 12 locales, so
 * the English key count is the growth lever that matters. Parity/sorted/coverage
 * already guarantee the catalogue's shape; this gate only caps its size.
 *
 * Closed at 11 286 keys with a 12 000-key budget (~6% headroom). Raising the
 * number is a deliberate, reviewed change — not a drive-by side effect of a
 * feature PR.
 *
 * Exits 0 within budget; 1 with a diagnostic otherwise.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const EN_LOCALE = resolve(
  import.meta.dir ?? new URL('.', import.meta.url).pathname,
  '..',
  'packages',
  'shared',
  'src',
  'i18n',
  'locales',
  'en.json',
)

/** O11 budget: en.json may not exceed this many keys. */
export const I18N_KEY_BUDGET = 12_000

const keys = Object.keys(JSON.parse(readFileSync(EN_LOCALE, 'utf8')) as Record<string, string>)

if (keys.length > I18N_KEY_BUDGET) {
  console.error(`i18n budget: en.json carries ${keys.length} keys, budget is ${I18N_KEY_BUDGET}.`)
  console.error('Shrink the catalogue or raise the budget deliberately (02-SPEC-foundations §11, O11).')
  process.exit(1)
}

console.log(`i18n budget: OK — ${keys.length}/${I18N_KEY_BUDGET} keys.`)