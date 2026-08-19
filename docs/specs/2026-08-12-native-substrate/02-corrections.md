# N-02. Поправки к вердикту (E1–E10)

- **Doc ID**: N-02
- **Статус**: draft
- **Дата**: 2026-08-13
- **Источник**: [N-AUDIT](../../superpowers/specs/2026-08-13-native-substrate-audit-findings.md)

Эти утверждения вердикта **не** определяют очередь работ.

| ID | Вердикт сказал | Факт в HEAD | Следствие |
|---|---|---|---|
| E1 | `craft-exec` P0 через PrivilegedExecutionBroker | Брокер не спавнит; Bash внутри Claude/Pi/OMP; 3 regex | P1 после host-tool Bash |
| E2 | MCP пишет `.credential-cache.json` | Writer удалён; live = `credentials.enc` | Удалить readers, не Rust mcpd |
| E3 | Нужен новый native RPC | `MessageEnvelope` 1.0 уже есть | UDS + тот же envelope |
| E4 | Схемы с `packages/core` | Провод в `protocol/dto.ts` | Канон = protocol |
| E5 | Поиск чисто лексический | Episodic уже embeddings | Index v1 не поглощает M2 |
| E6 | session-mcp-server живой | Никто не спавнит; pool in-process | Не супервизить мёртвый path |
| E7 | Knowledge watcher в craft-index | Polling провайдера | Другой bounded context |
| E8 | craft-icn — перенос inference | Lifecycle нет | Новый продукт, не сейчас |
| E9 | extraResources для бинаря | Toolchain manager уже качает native | Тот же путь, что omp |
| E10 | DoD 4 OS сейчас | Нет Windows runner, нет Rust CI | Linux+mac CI; Windows explicit gap |
