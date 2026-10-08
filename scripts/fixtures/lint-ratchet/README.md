# lint-ratchet fixtures

Used by `scripts/__tests__/lint-baseline.test.ts` to prove the UI token ratchet (UI-A2, #1568):

- `base/` is the "baselined" state: one legacy `z-50` and one legacy `z-index: 60`.
- `new-z/` is the same files with new numeric and arbitrary z values added.

Baselining `base/` and then checking `new-z/` must fail for `rox/no-hardcoded-z-index` (TSX) and
`stylelint/scale-unlimited/declaration-strict-value` (CSS). These files violate the rules on
purpose and are outside the ratcheted source trees.
