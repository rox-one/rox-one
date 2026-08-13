# N-04. Roadmap

- **Doc ID**: N-04
- **Статус**: draft
- **Дата**: 2026-08-13

## Сейчас (этот срез)

1. TS префакторы (facade, privileged-policy, dead credential-cache).
2. Baseline benches.
3. `craft-native` health/version/capabilities.
4. `craft-index` shadow за `CRAFT_FEATURE_NATIVE_SIDECAR` (default false).
5. Local crash-reconcile тест для CloudRunProvider.

## Следом

- Расширить conformance: process-tree kill, budget_exceeded (local-only где pid недоступен у cloud).
- `craft-rund` как adapter `CloudRunProvider`.
- Session journal dual-write.
- Host-tool Bash для Pi/OMP → затем `craft-exec`.

## По метрикам

- RPC transport rewrite (LLM latency >> RPC).
- Extension broker.
- Rust CLI.
- ICN + hwprobe.

## Не в этой программе

Zig, Kotlin/Android, Java, SessionManager translate, полный отказ от Electron.
