# Native substrate — suite N

- **Doc ID**: N
- **Статус**: draft
- **Дата**: 2026-08-13
- **Входные документы**: аудит [N-AUDIT](../../superpowers/specs/2026-08-13-native-substrate-audit-findings.md), план [N-PLAN](../../superpowers/plans/2026-08-13-native-substrate-workstreams.md)
- **Связанные документы**: [N-00](./00-overview.md), [N-01 ADRs](./01-adrs.md), [N-02 corrections](./02-corrections.md), [N-03 metrics](./03-baseline-metrics.md), [N-04 roadmap](./04-roadmap.md), [N-05 anti-goals](./05-anti-goals.md)
- **Репозиторий**: agisota/craft-agents-oss

Точка входа в suite. TypeScript остаётся control plane. Один Rust sidecar `craft-native` говорит существующим `MessageEnvelope` (`PROTOCOL_VERSION = 1.0`) по Unix socket. Первый модуль — source index в shadow-режиме.
