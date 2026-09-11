/**
 * Canonical Rox product vocabulary (Issue 02).
 *
 * Visible terms belong in normal UI. OMP / Pi / Craft / Hermes are
 * compatibility implementation metadata — technical detail only.
 */

export const ROX_VISIBLE_TERMS = {
  product: 'Rox',
  cli: 'Rox CLI',
  cloud: 'Rox Cloud',
  defaultAgentName: 'Agent Rox#001',
} as const

export type RoxVisibleTerm = (typeof ROX_VISIBLE_TERMS)[keyof typeof ROX_VISIBLE_TERMS]

export const COMPATIBILITY_RUNTIME_TERMS = ['OMP', 'Pi', 'Craft', 'Hermes', 'oh-my-pi'] as const

export type CompatibilityRuntimeTerm = (typeof COMPATIBILITY_RUNTIME_TERMS)[number]

export type CompatibilityContextKind =
  | 'technical-detail'
  | 'filesystem'
  | 'cli-binary'
  | 'legacy-dead'
  | 'external-product'

export interface TerminologyAllowlistEntry {
  /** Locale key prefix or exact key. Prefixes end with `.`. */
  match: string
  kind: CompatibilityContextKind
}

/** Locale keys that may still name compatibility runtimes. */
export const TERMINOLOGY_KEY_ALLOWLIST: readonly TerminologyAllowlistEntry[] = [
  { match: 'errors.omp.', kind: 'technical-detail' },
  { match: 'onboarding.ompCredential.', kind: 'technical-detail' },
  { match: 'onboarding.reauth.', kind: 'legacy-dead' },
  { match: 'skillsList.omp', kind: 'technical-detail' },
  { match: 'extensions.runtime.', kind: 'technical-detail' },
  { match: 'knowledge.', kind: 'external-product' },
  { match: 'hints.', kind: 'external-product' },
  { match: 'editPopover.example.addSource', kind: 'external-product' },
]

export function isAllowlistedLocaleKey(key: string): boolean {
  return TERMINOLOGY_KEY_ALLOWLIST.some((entry) =>
    entry.match.endsWith('.') ? key.startsWith(entry.match) : key === entry.match || key.startsWith(entry.match),
  )
}

export function isCompatibilityRuntimeTerm(value: string): boolean {
  const needle = value.trim()
  return (COMPATIBILITY_RUNTIME_TERMS as readonly string[]).some(
    (term) => term.toLowerCase() === needle.toLowerCase(),
  )
}

/** Runtime names that must not appear in normal-UI locale values. */
const FORBIDDEN_IN_NORMAL_UI: Array<{ id: string; pattern: RegExp }> = [
  { id: 'OMP', pattern: /\bOMP\b/ },
  { id: 'oh-my-pi', pattern: /oh-my-pi/i },
  { id: 'Hermes', pattern: /\bHermes\b/ },
  { id: 'Craft Agents', pattern: /Craft Agents/ },
  { id: 'Craft Agent', pattern: /Craft Agent(?!s)/ },
]

export function localeValueViolations(key: string, value: string): string[] {
  if (isAllowlistedLocaleKey(key)) return []
  // Craft Docs / craft.do are the external product, not this app.
  if (/Craft Docs|Craft space|craft\.do/i.test(value) && !/Craft Agents|Craft Agent(?!s)/.test(value)) {
    return []
  }
  return FORBIDDEN_IN_NORMAL_UI.filter((rule) => rule.pattern.test(value)).map((rule) => rule.id)
}
