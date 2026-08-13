# Промпт: native substrate, этап 0–1 (исправленный)

Скопировать целиком в новый агентный чат. Агент обязан прочитать указанные скиллы **до** правок кода.

---

## Goal

Закрыть ложную очередь «полиглотного переписона» и провести **первый strangler-срез**: TypeScript остаётся control plane; один Rust sidecar `craft-native` говорит уже существующим `MessageEnvelope` (`PROTOCOL_VERSION = '1.0'`) по Unix socket / named pipe; первый модуль за швом — source index в shadow-режиме. Дешёвые TS-префакторы и baseline-метрики идут раньше включения Rust как primary.

**Не цель:** переписать SessionManager, Bash, MCP, RPC, UI, inference, CLI; вводить Zig/Kotlin/Java; делать ICN.

## Skills (прочитать полностью, в этом порядке)

1. `/workspace/AGENTS.md` — стек Bun, i18n (10 локалей, ru default), OMP не трогать без нужды.
2. `/home/ubuntu/.agents/skills/codebase-design/SKILL.md` — словарь: module, interface, implementation, depth, seam, adapter, leverage, locality. Deletion test. «One adapter = hypothetical seam, two = real».
3. `/home/ubuntu/.agents/skills/improve-codebase-architecture/SKILL.md` — углублять существующие швы, не плодить мелкие модули.
4. `/home/ubuntu/.agents/skills/writing-plans/SKILL.md` — если план workstreams надо детализировать до TDD-шагов перед кодом.
5. `/home/ubuntu/.agents/skills/test-driven-development/SKILL.md` — failing test → implement → pass; characterization tests на текущее поведение до смены.
6. `/home/ubuntu/.agents/skills/verification-before-completion/SKILL.md` — не объявлять готовым без свежего прогона команд из Verification Contract.
7. `/home/ubuntu/.agents/skills/writing-for-agents/SKILL.md` — ADR писать как документ для следующего агента: шаги + completion criteria, без осадка.

Дом.стиль docs: `docs/specs/2026-08-07-unified-shell/00-overview.md` — русский, шапка Doc ID / Статус / Дата, без YAML front-matter.

## Authority (что считать фактом)

Читать и **следовать** этим документам. Если вердикт пользователя из прошлого чата спорит с ними — побеждает аудит.

- `docs/superpowers/specs/2026-08-13-native-substrate-audit-findings.md` — полный каталог ошибок вердикта (E1–E10), недочётов и проблем кода.
- `docs/superpowers/plans/2026-08-13-native-substrate-workstreams.md` — направления, предложения, units U0–U4.
- Живой код, не память: `packages/server-core/src/sources/source-index.ts`, `packages/server-core/src/services/privileged-execution-broker.ts`, `packages/shared/src/protocol/types.ts`, `packages/shared/src/protocol/dto.ts`, `packages/shared/src/feature-flags.ts`, `packages/cloud-runner/src/{types,conformance,local-provider}.ts`, `packages/shared/src/mcp/mcp-pool.ts`, `docs/superpowers/specs/2026-08-06-toolchain-download-manager-design.md`.

## Hard facts the agent must not re-litigate

1. `PrivilegedExecutionBroker` не исполняет команды. Bash живёт внутри Claude/Pi/OMP. `craft-exec` заблокирован до host-tool Bash.
2. Writer `.credential-cache.json` уже удалён. Живые credentials — `credentials.enc` + in-memory Bearer. Не строить Rust MCP supervisor ради этой утечки.
3. Native протокол = существующий `MessageEnvelope`, не новый. Канон DTO = `packages/shared/src/protocol/dto.ts`, не `packages/core`.
4. FTS пустой под Electron из-за `bun:sqlite`, не из-за «JS медленный». Сначала characterization + опциональный driver A/B.
5. `craft-native` доставлять toolchain download manager'ом, не `extraResources`.
6. CI сегодня без Windows runner и без Rust. DoD не обещает Windows.
7. Episodic memory уже умеет embeddings. Index v1 их не поглощает.
8. Knowledge watcher — polling провайдера, не filesystem indexer.
9. Zig в v1 не использовать. ICN не начинать.
10. Продакшн-колсайты source-index: RPC `sources.REINDEX`/`SEARCH` и `SessionManager` → `retrieveSourcesForPrompt`. Только они.

## Work now (порядок)

Делать **U0 → U1 → U2 → U3**. U4 параллелен после U1, не блокирует index.

### U0 — префакторы (TS)

Completion: facade — единственный import для четырёх функций; admin-regex в одном модуле; тесты брокера есть; credential-cache не читается как живой контракт.

### U1 — ADR + benches

Completion: suite `docs/specs/2026-08-12-native-substrate/` существует; `02-corrections.md` содержит E1–E10; `scripts/bench/index-bench.ts` пишет JSON на 1k/5k/20k под bun и node; числа в `03-baseline-metrics.md`.

### U2 — sidecar skeleton

Completion: `native/` собирается; handshake 1.0; каналы `native:health|version|capabilities`; TS supervisor уважает `CRAFT_FEATURE_NATIVE_SIDECAR` default false; падение sidecar не роняет сервер; `.github/workflows/native.yml` на self-hosted linux+macos.

### U3 — craft-index shadow

Completion: каналы `index:*`; facade в shadow гоняет TS+Rust, наружу TS; существующий `source-index.test.ts` зелёный с флагом и без.

## Expected results (артефакты)

Агент сдает все пункты, иначе работа не завершена:

1. ADR-suite из шести файлов в `docs/specs/2026-08-12-native-substrate/`.
2. Bench harness + хотя бы один JSON baseline.
3. `native/` cargo workspace с `craft-protocol` + `craft-native` + `craft-index`.
4. TS: `source-index-facade.ts`, `native/supervisor.ts`, `native/client.ts`, флаг в `feature-flags.ts`.
5. Тесты: broker; source-index parity (ts/shadow); cargo test; local-provider conformance (если U4 вошёл в diff).
6. CI workflow native.yml.
7. PR с описанием: что измерено, что за флагом, что сознательно не делалось (exec/ICN/Zig/Windows).

## Verification (прогнать и вставить вывод в PR)

```bash
bun test packages/server-core/src/sources
bun test packages/cloud-runner/src/__tests__/local-provider.test.ts
cargo test --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml -- -D warnings
bun scripts/bench/index-bench.ts
```

Если добавлены user-facing строки: `bun test packages/shared/src/i18n` и parity/sorted.

## Branching

- Ветки: `rox<descriptive-name>-4f9a`, lowercase.
- Не смешивать U0-префакторы и Rust-skeleton в одном непросматриваемом коммите; коммиты по unit.
- Base: `main`.

## Definition of done for the agent

Работа сделана, когда: флаг off сохраняет сегодняшнее поведение; shadow можно включить env-переменной; baseline записан; ложные P0 вердикта не реализованы; Windows не обещан; ни одного Zig/Kotlin/Java/ICN файла.
