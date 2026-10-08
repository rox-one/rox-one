/**
 * Stylelint for UI CSS (UI-A2, #1568; UI-AUDIT §8.2).
 *
 * Every rule reports as a warning; scripts/lint-baseline.ts ratchets the per-file counts in
 * eslint-baselines/ui-tokens.json alongside the rox/* ESLint rules, so counts can only go down.
 *
 * - Strict values: z-index, border-radius, font-size, box-shadow, color and background-color
 *   must come from a token (var(--*)) or a CSS keyword.
 * - color-no-hex outside the token files.
 * - px only on borders, outlines, shadows and custom properties (hairlines); sizes and spacing
 *   use rem or token vars.
 * - rox-css/no-theme-self-reference: no `--x: var(--x)` inside @theme (P2-22).
 * - rox-css/no-apply-numeric-z: no `@apply z-50` / `@apply z-[60]` (numeric z outside declarations).
 */

const KEYWORDS = [
  'inherit', 'initial', 'unset', 'revert', 'revert-layer',
  'transparent', 'currentColor', 'currentcolor', 'none', 'auto', '0',
]

module.exports = {
  defaultSeverity: 'warning',
  plugins: [
    'stylelint-declaration-strict-value',
    './scripts/stylelint/no-theme-self-reference.mjs',
    './scripts/stylelint/no-apply-numeric-z.mjs',
  ],
  ignoreFiles: ['**/node_modules/**', '**/dist/**', '**/release/**', 'apps/electron/resources/**'],
  rules: {
    'scale-unlimited/declaration-strict-value': [
      ['z-index', 'border-radius', 'font-size', 'box-shadow', 'color', 'background-color'],
      {
        ignoreVariables: true,
        // rgb()/hsl()/oklch() literals are not tokens; functions are allowed only when they
        // build on a token (calc(var(--z-chrome) + 1), color-mix(... var(--accent) ...)).
        ignoreFunctions: false,
        ignoreValues: [...KEYWORDS, '/var\\(--/'],
      },
    ],
    'color-no-hex': true,
    'declaration-property-unit-disallowed-list': {
      '/^(?!border|outline|box-shadow|--).+/': ['px'],
    },
    'rox-css/no-theme-self-reference': true,
    // At 0 from the start, so an error (the ratchet's flip-at-0 rule).
    'rox-css/no-apply-numeric-z': [true, { severity: 'error' }],
  },
  overrides: [
    {
      // The token files are where raw values are allowed to live.
      files: ['packages/ui/src/styles/tokens/*.css'],
      rules: {
        'color-no-hex': null,
        'scale-unlimited/declaration-strict-value': null,
        'declaration-property-unit-disallowed-list': null,
      },
    },
  ],
}
