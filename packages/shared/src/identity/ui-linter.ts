/**
 * Allowlist linter for user-facing Craft leaks in windows/menus (issue #341).
 * Does not rewrite @craft-agent or CRAFT_ identifiers.
 */

import { localeValueViolations } from './terms.ts'
import { ROX_BRAND_MANIFEST, ROX_PRODUCT_NAME } from './manifest.ts'

const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g
const IMPORT_LINE = /^\s*import\s.+$/gm
const PACKAGE_SCOPE = /@craft-agent\b/g
const ENV_PREFIX = /\bCRAFT_[A-Z0-9_]+\b/g

export const UI_BRAND_SCAN_ALLOWLIST = [
  '@craft-agent',
  'CRAFT_',
  'craft.do',
  'Craft Docs',
  'com.lukilabs.craft-agent',
  'craftagents:',
  '.craft-agent',
] as const

function stripIgnored(source: string): string {
  return source
    .replace(COMMENT, ' ')
    .replace(IMPORT_LINE, ' ')
    .replace(PACKAGE_SCOPE, ' ')
    .replace(ENV_PREFIX, ' ')
}

export function uiBrandViolations(source: string): string[] {
  const haystack = stripIgnored(source)
  const hits: string[] = []
  if (/Craft Agents/.test(haystack)) hits.push('Craft Agents')
  if (/Craft Agent(?!s)/.test(haystack) && !/Craft Docs/.test(haystack)) hits.push('Craft Agent')
  if (/thecraftagents\.com/i.test(haystack)) hits.push('thecraftagents.com')
  return hits
}

export function scanUiBrandSource(path: string, source: string): Array<{ path: string; hit: string }> {
  return uiBrandViolations(source).map((hit) => ({ path, hit }))
}

export function menuCopyUsesBrand(label: string): boolean {
  return label.includes(ROX_BRAND_MANIFEST.productName) || label.includes(ROX_PRODUCT_NAME)
}

export function localeMenuViolations(key: string, value: string): string[] {
  if (!key.startsWith('menu.')) return []
  return localeValueViolations(key, value)
}
