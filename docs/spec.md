# UTB-01 programmatic reference validation recovery

Parent: #1296 / draft #1314. Base: `a428eb42c5681adb15d97dcacc88ce45cef7e7a4`. Branch: `fix/utb-reference-strictness-20260930`. Owner: repo_audit; root retains review and delivery. Original feature branch stays unchanged.

## Scope and acceptance

- Preserve the published JSON v1 reference codec, opaque future-version retention, canonical identity keys, limits and five host kinds.
- Validate every own property of direct programmatic inputs, including nonenumerable and symbol keys. Unknown properties must fail with the existing safe error code.
- Reject own accessor descriptors before executing getters. Preserve known inert nonenumerable data fields rather than silently dropping them.
- Read capability evidence only through own data descriptors. Accessors cannot supply positive readiness, runtime or grant evidence; source/host/schema denial and per-capability intersection remain effective.
- Existing 54 tests plus meaningful adverse cases pass with Bun1.3.14 and Node22. Canonical type closure uses real repository sources and package export remains additive.
- Retain exact baseline typecheck failures and separate them from new diagnostics. No global compile gate is removed or replaced by a fixture.

This repair implements no Base persistence, row/schema operations, transport authorization, native editor mount, provider action or locale change. Availability metadata still requires actual owner authorization for every production operation. #1296 remains open until review, integration and its remaining gates; the sixteen subsequent UTB packages are not started by this patch.

## Delivery

Prepare a separate draft PR stacked on the current verified #1314 branch `feat/unified-tables-baserow-20260930`, without modifying that branch. Root reviews the exact code/receipt before publication. Full downstream validation awaits accepted main CI/core repairs; native and complete UTB product acceptance remain separately owned.
