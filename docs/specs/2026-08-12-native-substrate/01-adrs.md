# N-01. ADRs

- **Doc ID**: N-01
- **Статус**: draft
- **Дата**: 2026-08-13

## ADR-N1. Один sidecar, не десять демонов

`craft-native` — один процесс. Модули (index, позже rund/exec) — crates внутри него. `craft-icn` остаётся отдельным процессом *когда* появится local inference (другой lifecycle/GPU) — не сейчас.

## ADR-N2. Тот же MessageEnvelope

Sidecar не вводит второй RPC. Handshake требует major version `1.0`. Кадры: 4-byte big-endian length + UTF-8 JSON.

## ADR-N3. Source index — первый модуль

Продакшн-шов: четыре функции фасада. Два колсайта. Shadow: TS primary, Rust compare, diff в лог.

Rust пишет в `{workspace}/.craft/source-index.native.sqlite`, не в bun:sqlite файл.

## ADR-N4. craft-exec не P0

PrivilegedExecutionBroker не исполняет Bash. Host-tool Bash для Pi/OMP — предусловие. Zig sandbox-spawn — вместе с exec.

## ADR-N5. SQLite driver A/B на TS не заменяет sidecar, но обязан быть измерен

«FTS пустой в Electron» = нет `bun:sqlite`. Baseline bench гоняет bun и node. Rust оправдывается throughput / incremental / watcher / снятие 2000/32MB, не драйвером.

## ADR-N6. Episodic embeddings не в index v1

`memory.semantic` + Xenova остаются в TS. Knowledge watcher — polling провайдера, не filesystem indexer.

## ADR-N7. Windows x64 unsupported до появления CI runner

DoD этого среза: Linux x64 locally + self-hosted linux/macos CI. Не обещать Windows в пользовательских docs.

## ADR-N8. CloudRunProvider остаётся test surface для rund

Когда появится `craft-rund`, это третий adapter существующего интерфейса, плюс local-only crash-reconcile тесты (kill -9 нельзя гонять против Cloudflare).
