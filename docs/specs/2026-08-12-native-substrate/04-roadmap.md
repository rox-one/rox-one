# N-04. Roadmap

- **Doc ID**: N-04
- **Статус**: opt-in landed on `main` (flags default off)
- **Дата**: 2026-08-20

## Сейчас (этот срез)

1. TS префакторы (facade, privileged-policy, dead credential-cache).
2. Baseline benches.
3. `craft-native` health/version/capabilities.
4. `craft-index` shadow за `CRAFT_FEATURE_NATIVE_SIDECAR` (default false).
5. Local crash-reconcile / process-tree / `budget_exceeded` тесты для CloudRunProvider.
6. `craft-rund` как adapter `CloudRunProvider` (`run:*` на том же sidecar, `NativeRunProvider`). `makeProvider` выбирает native при `cloudRuns.provider=native` + флаг sidecar.
7. Session journal dual-write: TS пишет `session.jsonl`, sidecar — `{sessionDir}/session.native.jsonl` за тем же флагом. Characterization: оборванная последняя строка JSONL не роняет сессию.

## Следом

- Host-tool Bash для Pi/OMP → затем `craft-exec`. **Landed:** OMP + Pi execute through craft; `exec:run` on the sidecar with local fallback.
- Production wiring `cloudRuns.provider = native` за флагом. **Landed.**
- Journal primary на Rust (после стабилизации shadow). **Landed behind `CRAFT_FEATURE_NATIVE_JOURNAL_PRIMARY=1`:** persistence queue writes `session.jsonl` via `journal:writePrimary`, falls back to TS on sidecar failure. Shadow `session.native.jsonl` stays.
- Index primary на Rust (N-03: снять 2000/32MB). **Landed behind `CRAFT_FEATURE_NATIVE_INDEX_PRIMARY=1`:** `craft-index` caps are 20k files / 256MB; facade uses `index:reindex/search/retrieve/count` first, TS fallback on sidecar failure. TS walk stays 2000/32MB.
- Incremental reindex + metrics CLI. **Landed:** `craft-index` skips unread files when mtime matches (`written`/`unchanged` on reindex). `craft-native --index-status <workspace>` prints `{ dbPath, fts, indexed }` JSON. No RPC rewrite, no FS watcher.
- Toolchain delivery of `craft-native`. **Landed as opt-in detect (unix only):** registered `ToolName`, no `extraResources`, no Windows. Until GitHub artifacts exist, seed a local binary into `toolchain/craft-native/current/bin`. Supervisor resolve order: `CRAFT_NATIVE_BIN` → toolchain current → cargo debug/release.
- Cautious exec cwd jail. **Landed:** `craft-exec` and host-tool Bash canonicalize cwd and reject paths outside `workspaceRoot`. Not a full sandbox (no Zig spawn, no network namespace).
- Index status RPC/CLI. **Landed:** `sources:status` returns `{ primary, sidecarLive, indexed, fts, dbPath }`. Sources list loads it on workspace change. `craft-native --health` prints sidecar identity JSON.
- Server health includes native sidecar. **Landed:** `server:getHealth` / HTTP `/health` check `native_sidecar` (disabled = pass; enabled+down = fail). CLI: `craft-cli server-health`.
- Server settings show sidecar status. **Landed:** Settings → Server reads `server:getHealth` and shows Native sidecar off / connected / down.

Local-only process-tree kill и `budget_exceeded` закрыты тестами в `local-provider.test.ts` и crate `craft-rund` (не в shared conformance — у Cloudflare нет pid).

## По метрикам

- RPC transport rewrite (LLM latency >> RPC).
- Extension broker.
- Rust CLI.
- ICN + hwprobe.

## Не в этой программе

Zig, Kotlin/Android, Java, SessionManager translate, полный отказ от Electron.
