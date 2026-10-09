# Memory

Documentation for ROX memory and self-improvement subsystems.

- [Continual learning](./learning.md) — the learning loop, entities,
  deterministic validation, confidence/effectiveness, thresholds and
  `skills.learning` config, rollback, storage layout, the `learning:*` RPC
  surface, the Learning UI, and the operator runbook (PRD §48 norm).
- [Memory repository & dreams](./learning.md#репозиторий-памяти-и-сны) — the
  markdown/git **projection** of the existing memory stores: bank taxonomy
  (`main` | `ws:<id>` with optional `#owner8`), file layout, the no-telemetry
  rule, the human-edit guard (`.meta.json` `files[<path>]` hash → `.conflicts/`), import via proposals,
  and the dream pipeline (`whenIdle → notes → proposals → consolidation → decay
  → materialize + commit`). Wave A implementation status, WP-01 spike numbers
  and deviations from the proposal live in
  [`docs/plans/2026-10-09-memory-repository-and-dreaming.md`](../plans/2026-10-09-memory-repository-and-dreaming.md) §0.