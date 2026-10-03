# Credential locator own-data validation

Base revision: `635fc495d02c3fe1380740444cb90cf4fbdb58d9`. Toolchain: task-owned official Bun 1.3.14 (`0d9b296a`), frozen dependencies with install scripts skipped; no lockfile or workflow changes. The primary checkout's existing CSS edits were preserved.

## Defect and correction

The former descriptor loop inspected only existing own fields, then read required fields normally. Ordinary Object.prototype inheritance could supply missing metadata or execute getters. The correction copies only own enumerable data descriptor values into a null-prototype record before applying existing provider validation. Descriptor `value` must itself be own data; external custom/null prototypes, accessors, symbols, hidden/unknown keys, invalid strings and the existing provider schema remain rejected. Valid frozen records retain their behavior.

## Regression evidence

The final suite is part of the existing `credential-types.test.ts`, so the unchanged connection-fabric CI command executes it. It covers all ten provider variants, each required field including the discriminator, inherited data/getters, registration, provider replacement, attachment and real disk reload. Rejection preserves registry state and metadata bytes or leaves metadata files absent. Additional controls cover frozen registration/replacement/attachment/restart, an accessor descriptor inheriting `value`, and ordinary Proxy get traps.

Initial reproduction against unchanged source: 63 new cases, 10 positive passes and 53 expected failures. Final negative control restores only the original validator source while retaining the final tests: `bun test packages/core/src/platform/identity/credential-types.test.ts packages/core/src/platform/identity/attach-credential-ref.test.ts` exits 1 with 49 pass / 54 fail, 424 assertions, 103 tests across two files. The corrected source is restored in finally and its SHA-256 is verified as `b63765134c2781df5674255c883ce48bf4ad08fa4ca115dd02d211ca697a2a16`.

The corrected full core run exits 0: 971 pass / 0 fail, 4465 assertions, 81 files. Core TypeScript exits 0 with no diagnostics. The unchanged `validate:ci` also exits 0 with nine compiler contexts, passing Bun/document checks and all i18n gates; the optional absent OSS pages-worker skip is retained. Exact final-revision local/Linux results, relevant hosted workflow receipts, independent review and merge/main readback are recorded in the delivered task report; historical validation at 6cf191dd is not substituted for this new candidate.

## Scope

The functional change is limited to locator validation and its regression tests. Existing CI commands and assertions are preserved. Hosted validation and built server lifecycle are required for this candidate's delivery; deployment account state and native UI/provider acceptance are separate from this correction.

During final validation, main `74b8de9554c34b383b6254b30479c877435bb1db` incorporated PR #1407 with the identical executable validator correction and 54 inherited-field regressions. PR #1408 preserves that production code and all upstream cases, adding its 64 boundary/persistence/frozen/Proxy cases. Proof for initial candidate `bd0c76feaa254bca0d254f99538d0fa80a109e8a` remains scoped to that commit; the combined candidate must receive fresh full core, TypeScript, comprehensive CI and built lifecycle evidence before delivery.
