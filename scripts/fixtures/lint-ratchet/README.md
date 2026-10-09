# lint-ratchet fixtures

Used by `scripts/__tests__/lint-baseline.test.ts` to prove the UI token ratchet (UI-A2, #1568).
These files violate the rules on purpose and are outside the ratcheted source trees.

- `base/` is the "baselined" state: one legacy `z-50` and one legacy `z-index: 60`.
- `new-z/` is the same files with new numeric and arbitrary z values added. Baselining `base/`
  and then checking `new-z/` must fail for `rox/no-hardcoded-z-index` (TSX) and
  `stylelint/scale-unlimited/declaration-strict-value` (CSS).
- `directives/` proves that disable comments do not hide violations: only next-line / same-line
  directives that name the rule and give a `-- justification` are exempt. It also has an
  `@apply z-50` for `rox-css/no-apply-numeric-z`.
- `ungated/` proves that ungated rules/messageIds (raw error render, raw checkbox) stay out of the
  gate while `<select>` (a Select primitive exists) stays gated.
