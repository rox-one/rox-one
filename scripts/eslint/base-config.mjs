/**
 * Shared flat ESLint base for the workspaces covered by the DX-03 ratchet
 * (`scripts/eslint-workspace-ratchet.ts`, `.github/workflows/eslint-workspaces.yml`).
 *
 * Why a ratchet base instead of plain `js.configs.recommended`:
 * these workspaces predate ESLint coverage, so the recommended rules already report a few
 * hundred violations. Running them as errors would make the lint command red on day one. Like
 * the UI token ratchet (`scripts/lint-baseline.ts`), the rules here are gated at warning
 * severity: `npx eslint` stays green, and `scripts/eslint-workspace-ratchet.ts` fails any
 * growth against `eslint-baselines/workspaces/<name>.json`.
 *
 * The rule set is @eslint/js recommended + @typescript-eslint recommended (the non-type-checked
 * variant; a type-aware pass would need per-workspace project wiring and much longer runs), with
 * every rule downgraded to `warn` (except React Hooks' `rules-of-hooks`, which has no current
 * violation and stays an error). Tests, fixtures, declaration files and build output are ignored.
 */

import js from '@eslint/js'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

/** Source extensions the gated workspaces ship. */
export const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']

/** Root-relative glob the ratchet lints per workspace. */
export const SOURCE_GLOB = `src/**/*.{${SOURCE_EXTENSIONS.join(',')}}`

/** Patterns the ratchet and the configs both exclude (kept in sync by hand; the ratchet asserts on them). */
export const IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
]

/** Downgrade every enabled rule to `warn`; the ratchet, not the severity, is the gate. */
function asWarnings(rules) {
  const gated = {}
  for (const [rule, entry] of Object.entries(rules)) {
    const level = Array.isArray(entry) ? entry[0] : entry
    if (level === 'off' || level === 0) continue
    gated[rule] = Array.isArray(entry) ? ['warn', ...entry.slice(1)] : 'warn'
  }
  return gated
}

/** The `@typescript-eslint` recommended rules plus the ESLint core rules it decides to turn off. */
function typescriptRules() {
  return {
    ...js.configs.recommended.rules,
    ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
    ...tsPlugin.configs.recommended.rules,
  }
}

/**
 * Flat config for one gated workspace. `react` adds the React Hooks rules for the renderer apps.
 */
export function workspaceConfig({ react = false } = {}) {
  const plugins = { '@typescript-eslint': tsPlugin }
  const rules = asWarnings(typescriptRules())
  if (react) {
    plugins['react-hooks'] = reactHooksPlugin
    // rules-of-hooks has no current violation and catches real bugs: keep it an error.
    rules['react-hooks/rules-of-hooks'] = 'error'
    rules['react-hooks/exhaustive-deps'] = 'warn'
  }
  return [
    { ignores: IGNORES },
    {
      files: SOURCE_EXTENSIONS.map((extension) => `**/*.${extension}`),
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
        globals: { ...globals.node, ...globals.browser },
      },
      // Same counting rule as the UI token ratchet (scripts/lint-baseline.ts): inline config is
      // ignored, so a `/* eslint-disable */` comment cannot hide a violation from the count.
      // Justified next-line/same-line directives are exempted by the ratchet afterwards.
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
      plugins,
      rules,
    },
  ]
}

export default workspaceConfig