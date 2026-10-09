/**
 * rox/* UI token lint rules: one plugin, one severity table (UI-A2, #1568; UI-AUDIT §8.1).
 *
 * Used by apps/electron/eslint.config.mjs, packages/ui/eslint.config.mjs and the CI ratchet
 * (scripts/lint-baseline.ts), so editors, `bun run lint` and CI see the same rules there.
 * apps/viewer and apps/webui have no ESLint config: their trees are ratcheted in CI only.
 *
 * Every rule starts at 'warn'. The ratchet keeps per-file counts in
 * eslint-baselines/ui-tokens.json from growing. A rule whose baseline total reaches 0 must be
 * flipped to 'error' here; `bun run lint:ui-tokens` fails until it is.
 */

const noHardcodedZIndex = require('./no-hardcoded-z-index.cjs')
const noArbitraryRadius = require('./no-arbitrary-radius.cjs')
const noArbitraryTextSize = require('./no-arbitrary-text-size.cjs')
const noRawColor = require('./no-raw-color.cjs')
const noForegroundOpacity = require('./no-foreground-opacity.cjs')
const iconSizeTokens = require('./icon-size-tokens.cjs')
const noRawErrorRender = require('./no-raw-error-render.cjs')
const preferPrimitives = require('./prefer-primitives.cjs')
const noBackdropOnOverlay = require('./no-backdrop-on-overlay.cjs')

const plugin = {
  meta: { name: 'rox' },
  rules: {
    'no-hardcoded-z-index': noHardcodedZIndex,
    'no-arbitrary-radius': noArbitraryRadius,
    'no-arbitrary-text-size': noArbitraryTextSize,
    'no-raw-color': noRawColor,
    'no-foreground-opacity': noForegroundOpacity,
    'icon-size-tokens': iconSizeTokens,
    'no-raw-error-render': noRawErrorRender,
    'prefer-primitives': preferPrimitives,
    'no-backdrop-on-overlay': noBackdropOnOverlay,
  },
}

/**
 * Severity table. Style-object zIndex literals stay on the long-standing
 * craft-styles/no-hardcoded-z-index error (v1 behaviour, see Z_INDEX_V1); the rox
 * z rule adds the v2 class and deprecated-alias checks on top.
 */
const rules = {
  'rox/no-hardcoded-z-index': ['warn', { checkStyle: false }],
  'rox/no-arbitrary-radius': 'warn',
  'rox/no-arbitrary-text-size': 'warn',
  'rox/no-raw-color': 'warn',
  'rox/no-foreground-opacity': 'warn',
  'rox/icon-size-tokens': 'warn',
  'rox/no-raw-error-render': 'warn',
  'rox/prefer-primitives': 'warn',
  // Flipped to error at 0 violations by the 2026-10-09 ratchet update (KanbanColumn overlay fixed).
  'rox/no-backdrop-on-overlay': 'error',
}

/** craft-styles/no-hardcoded-z-index: the v1 style-object check, unchanged and still an error. */
const Z_INDEX_V1 = ['error', { checkClasses: false, checkDeprecatedAliases: false }]

/**
 * Rules (or messageIds) that warn in editors but are NOT part of the --check growth gate,
 * because new code has no compliant fix yet. Each entry names the work that lands the fix;
 * when it merges, delete the entry and rebaseline (`bun run lint:ui-tokens:update`).
 *
 * TODO(#1569 UI-A3): gate rox/no-raw-error-render once presentError() exists.
 * TODO(#1592 UI-C1): gate prefer-primitives rawCheckbox once the Checkbox primitive exists.
 * (role="tab" stays gated: Tabs exists in components/ui/tabs; <select> stays gated: Select
 * exists in components/ui/select; titles -> @rox/ui Tooltip; overlays -> Dialog/Sheet.)
 */
const UNGATED = {
  'rox/no-raw-error-render': { messageIds: null, until: '#1569 (UI-A3: presentError)' },
  'rox/prefer-primitives': { messageIds: ['rawCheckbox'], until: '#1592 (UI-C1: Checkbox primitive)' },
}

/** Is this message outside the ratchet gate? */
function isUngated(ruleId, messageId) {
  const entry = UNGATED[ruleId]
  if (!entry) return false
  return entry.messageIds === null || entry.messageIds.includes(messageId)
}

/**
 * Test-file globs for the given extensions. A package config must pass only the extensions it
 * already lints: in flat config a non-universal `files` glob adds matching files to the lint set,
 * so `*.test.mts` here would make `eslint src/` parse .mts without a TS parser.
 */
function testFilesFor(extensions) {
  return ['**/__tests__/**', `**/*.{test,spec}.{${extensions.join(',')}}`]
}

/** Tests and fixtures assert on banned strings on purpose; they are outside the ratchet (every JS/TS flavour). */
const TEST_FILES = testFilesFor(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'])

const off = Object.fromEntries(Object.keys(rules).map((rule) => [rule, 'off']))

module.exports = { plugin, rules, off, Z_INDEX_V1, TEST_FILES, testFilesFor, UNGATED, isUngated }
