# Cloud implementation operator contract

Read root AGENTS.md, product/PRD.md, UI-UX-CONTRACT.md, assigned packet and prior verified dependency receipts. User authorised preparation here; this folder prepares future execution. It does not launch agents itself.

1. One work package/isolated branch/owner. Scheduler supplies exact integration inputSha and specification digest. Fetch and verify that SHA and dependencies; do not reset to historical f632/e780 baseline after prerequisites were implemented.
2. Modify only packet owned paths plus `proof/macro-integration/<WP-ID>/` and the assigned receipt file. Before modifying shared registry/contracts/migrations/transport/lockfile, reserve ownership; another branch changing same path must merge/rebase according to root user policy (default merge, not rebase). Interface change updates packet/digest before dependent launch.
3. Existing ROX destination and canonical entity model first. Do not create MacroTasks/MacroPages/separate users/notifications/second theme/Solid framework. Distinguish human Message and agent Session. Cross-entity link does not confer permission.
4. Use targeted project scripts/tests; read source before editing. Verify pinned Bun/toolchain/lockfile; frozen install; do not silently rewrite bun.lock to accommodate worker machine.
5. Authenticated Actor server-side; read/write/share/search/agent/offline replay through same policy. All existing RPC/IPC/legacy store writers fenced before enabling shared mode. No fixture to live status promotion.
6. RED meaningful user scenario, implement, GREEN, seed failure control, persistence/recovery/concurrency, related regression, actual UI/ARIA if visible. Return exact expected/observed and redacted proof hashes. A planning JSON validator is not feature proof.
7. Cloud Linux handles domain and renderer fixtures. Native macOS and provider-live may be separate executors; packet stays pending until required receipts arrive. Missing device/secret/provider is an actionable external gate, not simulated success.
8. External test uses dedicated tenant, bounded budgets and scoped ephemeral secrets supplied by executor. Never read arbitrary personal .env, private logs/keychain/vault or production mail. Redact payloads; no credentials in prompt/PR/screenshots.
9. No literal Macro source copy until origin/license gate. Behavior reimplementation default. Record dependencies/licensing in release manifest.
10. Finish commit+diff+receipt+draft PR when available. No merge/deploy/force push/main changes. Scheduler integrates reviewed commits and reruns seam tests, then issues successor inputSha. Review must inspect evidence, not accept status=done alone.

No package is complete while required lane is not_run/pending/failed, prerequisites not proven, or target/source changed without reconciliation. Preserve failed attempts and reproduction seeds; resumed worker verifies current branch and receipt state.
