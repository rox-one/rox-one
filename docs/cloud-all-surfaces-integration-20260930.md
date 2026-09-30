# Isolated Cloud integration: UI + September + Compound

This branch assembles the published UI, September and scoped Compound source in an isolated managed Cloud checkout. It preserves the active Mac owner branches and the original main checkout. It is an integration delivery; original programme criteria and platform acceptance remain independently applicable.

## Immutable inputs and merge provenance

The machine-readable manifest beside this file records exact remote SHAs, the 28 initial September/Compound conflict paths, all stage blob IDs, resolution owners and programme acceptance state. September `ea083e387e170552ee6102e29c2cf31adc8b6973` is the integration base; Compound `8106f22185fb3b3e9a6a585320d48b1bf5f10fbd` is the first ordinary merge input. SQLite recovery is imported from the separate owner's published normal merge `da78e3e79f5c268a33fc429d2913e8b8d59adeac`; no new SQLite adapter is authored here. Final commit parents and source-bound verification receipts are recorded in the validation delivery receipt.

The one-surface/header source branch is `factory/ship-rox-ui-shell-onesurface-86e136bd` at `55abb1a18b21779ee765bb10e30798301aa424cb`. Its renderer bytes were merged at `6e8daa29fdfc4a8a4e09fdf8f5c194ce1b3a9446` (#1041). The expanded left rail is `9d9c7e90e13777181f84d7e18353de649e9985b4` (#1051); the later layout adjustment is `a3599c1bfaebc00e783e63780556b8e24c05b7f8` (#1054). These are ancestors of the integration base; reapplying the old UI branch would reintroduce older code.

## Integration requirements

- Preserve September native authority, current-caller and post-await fences, main-owned encrypted durable outbox, observed receipt ACK and custody.
- Canonical native Note writes pass through the main-owned durable queue and NativeJournal. A native path must never create, recover or activate a parallel legacy Markdown file writer.
- Preserve Compound scoped project authority, shared projection, repository snapshot, content descriptors/block editor, Quick Task and related surfaces. Read-only projections and explicit legacy contexts retain separate authority boundaries.
- Preserve September Search, OKR, Mini Session, native budget, stale/retry feed handling and focused-route restore.
- Integrate published roadmap read/save/flush acknowledgements and CAS without replacing September/Compound ProjectInfo behavior. Failed reads/saves cannot advance provider/export work or discard drafts.
- Keep immutable SQLite owner source and compare the core, roadmap, hosted CI and strict UTB recovery references. Carry additive reviewed fixes while preserving stronger September identity/calendar/recurrence and voice provenance.
- Keep both complete original September and Compound spec/plan contracts. UTB reference strictness is a starter boundary gate, not Base persistence, CRUD, renderer or full UTB acceptance.

## Required verification and delivery

Frozen install uses Bun 1.3.14 and Node 24, with private temporary config/caches outside source and existing proxy/TLS trust. Build environments do not forward provider/OAuth credentials or load a checkout `.env`. Run core/shared/server-core/server/WebUI/Electron type gates, the full Electron target, subprocess/WebUI/Bun server builds, scoped domain and canonical negative/restart tests, and the exact built-server smoke revision. Actual browser checks must mount the renderer and inspect header/sidebar/routes/states with screenshots; returning HTML alone is insufficient.

Independent semantic review covers both manually resolved conflicts and automatic merges. The final receipt identifies tested source SHA, commands, actual counts, failure file/line, screenshots/artifact hashes, native availability and infrastructure limits. Commit, push, draft PR and remote readback are part of delivery. Original checkout cleanliness and own-process/profile cleanup are checked after execution.

## Acceptance still pending

The 109 September criteria, 143 Compound criteria, UTB product criteria, DATA/SHARED, installed Mac/native/provider/iOS and full product release DoD remain pending until their owners provide the required real proof. Cloud source/type/build/browser/scoped runtime results are recorded at their actual scope. No issue is closed or full programme marked accepted by this branch.

## Observed repairs during assembly

- Actual authenticated WebUI on the historical recovery revision failed before rendering because the Vite builtin shim redirected bare `buffer` to the same module that imported `buffer`. The integration repairs resolver selection and requires a cold bundle import plus a real browser rerun.
- Semantic review found Notes channels accidentally becoming local-only and a content service capable of activating a competing Markdown writer. Integration keeps authenticated native routing and fails closed before legacy mutation/recovery on native contexts.
- Negative tests reproduced inert credential locator and caller-clock defects; reviewed narrow core fixes preserve the newer September account-replica, deterministic-ID, recurrence and timezone behavior.
- Editor queue CAS must reject foreign identity/revision changes while allowing progression derived only from its own verified observed receipt and main ACK.
