# N-04. Roadmap

- **Doc ID**: N-04
- **Статус**: draft
- **Дата**: 2026-08-13

## Сейчас (этот срез)

1. TS префакторы (facade, privileged-policy, dead credential-cache).
2. Baseline benches.
3. `craft-native` health/version/capabilities.
4. `craft-index` shadow за `CRAFT_FEATURE_NATIVE_SIDECAR` (default false).
5. Local crash-reconcile / process-tree / `budget_exceeded` тесты для CloudRunProvider.
6. `craft-rund` как adapter `CloudRunProvider` (`run:*` на том же sidecar, `NativeRunProvider`). `makeProvider` по-прежнему default `local`.
7. Session journal dual-write: TS пишет `session.jsonl`, sidecar — `{sessionDir}/session.native.jsonl` за тем же флагом. Characterization: оборванная последняя строка JSONL не роняет сессию.

## Следом

- Host-tool Bash для Pi/OMP → затем `craft-exec`.
- Production wiring `cloudRuns.provider = native` за флагом.
- Journal primary на Rust (после стабилизации shadow).

Local-only process-tree kill и `budget_exceeded` закрыты тестами в `local-provider.test.ts` и crate `craft-rund` (не в shared conformance — у Cloudflare нет pid).

## По метрикам

- RPC transport rewrite (LLM latency >> RPC).
- Extension broker.
- Rust CLI.
- ICN + hwprobe.

## Не в этой программе

Zig, Kotlin/Android, Java, SessionManager translate, полный отказ от Electron.
