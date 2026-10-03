# Native substrate — workstreams и task breakdown

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Spec: `docs/superpowers/specs/2026-08-13-native-substrate-audit-findings.md`
> Prompt: `docs/superpowers/specs/2026-08-13-native-substrate-agent-prompt.md`

**Goal:** Исправить ложную очередь вердикта, снять baseline до rewrite и провести первый strangler-срез (`craft-native` + `craft-index`) за флагом, не устраивая полиглотный переписон.

**Architecture:** TypeScript остаётся control plane. Один Rust sidecar (`craft-native`) говорит существующим `MessageEnvelope` по UDS/named pipe. Первый модуль за швом — source index. Дешёвые TS-префакторы (мёртвый credential-cache, SQLite driver A/B, facade) идут раньше native-кода.

**Tech Stack:** Bun + существующий `@craft-agent/shared/protocol`; Rust 1.83 + tokio + rusqlite + ignore + notify + blake3; feature flag `CRAFT_FEATURE_NATIVE_SIDECAR`; toolchain download manager для доставки бинарника.

## Global Constraints

- Не переписывать SessionManager, UI, Claude/Pi adapters, CDP, tool definitions.
- Не вводить Zig, Kotlin, Java, ICN в этом плане.
- Sidecar использует `PROTOCOL_VERSION = '1.0'` и `MessageEnvelope`, не новый codec.
- Проводные DTO снимать с `packages/shared/src/protocol/dto.ts`, не с `packages/core`.
- `craft-native` доставляется через toolchain download manager, не через `extraResources`.
- TS fallback остаётся включённым по умолчанию. Флаг default `false`.
- CI native: self-hosted linux + macos. Windows — явный риск, не скрытый DoD.
- i18n: любые user-facing строки — `t()` во все 10 локалей, ASCII-sorted keys.

---

## Как построена работа

Три параллельных контура, один критический путь.

```text
Prefactors (TS) ──► Baseline benches ──► ADR suite
                         │
                         ▼
              craft-native skeleton (health RPC)
                         │
                         ▼
              craft-index shadow ──► flag flip
                         │
                         ▼
              craft-rund adapter (тот же sidecar, другой модуль)
```

Prefactors не блокируют ADR, но блокируют «мы переписали, потому что FTS не работает в Electron» — сначала доказать, что драйвер SQLite недостаточен.

Улучшение относительно вердикта: сначала **удаление и измерение**, потом **один шов**, потом **один sidecar**. Доделка: shadow-parity и rollback, а не «Rust компилируется».

---

## Направления и предложения

Каждое направление: диагноз → несколько предложений, что делать **сейчас**. Не «когда-нибудь».

### A. Контракты и control plane

Диагноз: вердикт предлагает новые schemas/ и новый native RPC, хотя провод уже есть, а канон — `dto.ts`. Swift уже ручной зеркало.

Предложения:

1. Зафиксировать ADR: канон = `packages/shared/src/protocol/{types,channels,dto,events}.ts`. Sidecar — тот же envelope.
2. Снять JSON Schema **только** для native-каналов (`native:*`, `index:*`, `run:*`), не для всего продукта.
3. Добавить golden fixtures handshake/request/event, общие для TS-теста и Rust-теста.
4. Отложить protobuf/binary codec до профилирования.

### B. Index / search

Диагноз: sync walk, потолки 2000/32MB, bun:sqlite-only, нет watcher, два колсайта.

Предложения:

1. Вынести facade с теми же четырьмя функциями: `reindexWorkspaceSources`, `searchSourceIndex`, `retrieveSourcesForPrompt`, `countIndexedFiles`.
2. A/B: подключить `better-sqlite3` (или `node:sqlite`) на том же файле БД и прогнать существующие тесты под node. Если Electron-поиск оживает — часть аргумента «нужен Rust» снимается; остаётся throughput/incremental/watcher.
3. Снять bench на 1k/5k/20k файлов под bun и node **до** Rust.
4. Rust `craft-index` за shadow-флагом: compare hits, log diffs, TS остаётся primary.
5. Knowledge watcher **не** класть в index sidecar. Episodic embeddings — отдельное решение в ADR (не поглощать в v1).

### C. Execution / security

Диагноз: брокер не исполняет; Bash внутри бэкендов; caps только у `script_sandbox`.

Предложения:

1. Свести admin-regex в один модуль (сейчас drift между broker и `pre-tool-use.ts`). Написать тесты брокера.
2. Персистить pending approvals (сейчас Map). Это TS, не Rust.
3. Для Pi/OMP: спроектировать host-tool Bash (шов уже есть у OMP). Не трогать Claude CLI Bash в v1.
4. Не стартовать `craft-exec` и не писать Zig `sandbox-spawn`, пока host-tool Bash не существует хотя бы для одного бэкенда.

### D. Durable runs

Диагноз: контракт `CloudRunProvider` + conformance уже есть. Local provider доверяет pid-файлу и не убивает дерево.

Предложения:

1. Расширить conformance: crash-resume (`kill -9` → reconcile), process-tree kill, `budget_exceeded`. Это укрепляет шов до Rust.
2. Реализовать `craft-rund` как **ещё один adapter** того же интерфейса, не как отдельную семантику.
3. Прогнать `conformanceSuite(() => new NativeRunProvider(...))` тем же тестом, что local.

### E. Session persistence и SessionManager

Диагноз: god object 434 КБ; JSONL операционная база; один удачный узкий шов (source retrieve).

Предложения:

1. Не переносить SessionManager. Выделить порты только там, где native уже стучится: PersistencePort не в v1, SourceRuntimePort — facade из B.
2. Добавить crash-recovery тест на текущий JSONL (оборванная последняя строка) — characterization, до journal rewrite.
3. Journal на Rust — P1 после dual-write, не сейчас.

### F. MCP и секреты

Диагноз: живой путь in-process и уже без plaintext cache. Мёртвый subprocess path ещё в дереве.

Предложения:

1. Удалить readers `.credential-cache.json` и бандл-зависимость, оставить cleanup на один релиз.
2. Не писать `craft-mcpd` в v1: нечего супервизить сверх pool, который живёт в процессе.
3. Если нужен supervisor — начать с restart/health **вокруг существующего stdio spawn в `CraftMcpClient`**, на TS.

### G. Транспорт, CLI, клиенты

Диагноз: WS JSON уже умеет handshake/replay. CLI grep stdout. Swift ручной.

Предложения:

1. Sidecar: length-prefixed JSON тех же envelope types по UDS. Не WS внутри localhost без нужды, не новый schema language.
2. Readiness sidecar: health RPC, не парсинг stdout. Параллельно можно починить CLI spawner тем же приёмом (отдельный маленький TS-PR).
3. Codegen Swift/Kotlin — отдельная программа после стабилизации native-каналов. KMP не начинать.

### H. Build / CI / packaging

Диагноз: нет Rust CI, нет Windows runner, toolchain manager уже качает native.

Предложения:

1. `.github/workflows/native.yml` на self-hosted linux+macos: fmt, clippy, test.
2. Зарегистрировать `craft-native` в toolchain manifest по образцу omp.
3. Явно записать в ADR: Windows x64 — unsupported до появления runner. Не обещать в DoD.
4. Не чинить в этом плане отсутствующие `scripts/build.ts` / `scripts/upload.ts`, если они не на критическом пути sidecar.

### I. Local inference (ICN)

Диагноз: продукта нет, шва нет, GPU lifecycle другой.

Предложения:

1. ADR-абзац: ICN — отдельный процесс *когда* появится local providerType, не сейчас.
2. Не добавлять llama.cpp / ggml в дерево в этом плане.
3. Hardware probe отложить; когда понадобится — Rust crate, не Zig.

---

## File map (критический путь)

| Path | Responsibility |
|---|---|
| `docs/specs/2026-08-12-native-substrate/` | ADR suite (overview, ADRs, corrections, metrics, roadmap, anti-goals) |
| `scripts/bench/index-bench.ts` | Синтетическое дерево + walk/index/search timing |
| `scripts/bench/journal-bench.ts` | persistence-queue throughput |
| `scripts/bench/rpc-bench.ts` | WsRpc round-trip p50/p95 |
| `scripts/bench/runner-recovery-bench.ts` | kill -9 reconcile latency |
| `packages/shared/src/feature-flags.ts` | `CRAFT_FEATURE_NATIVE_SIDECAR`, optional `CRAFT_FEATURE_SOURCE_INDEX_SQLITE_DRIVER` |
| `packages/server-core/src/sources/source-index-facade.ts` | Единственный шов для четырёх функций |
| `packages/server-core/src/native/supervisor.ts` | Spawn, health-wait, backoff, disable-after-N |
| `packages/server-core/src/native/client.ts` | Envelope client over UDS |
| `native/Cargo.toml` | Workspace |
| `native/crates/craft-protocol` | serde MessageEnvelope |
| `native/apps/craft-native` | Sidecar binary |
| `native/crates/craft-index` | FTS index module |
| `.github/workflows/native.yml` | cargo fmt/clippy/test |

---

## Implementation Units

### U0. Prefactors (можно параллельно с ADR)

**Blocked by:** none.

**Files:**
- Modify: `packages/session-mcp-server/src/index.ts` (удалить credential-cache read path или пометить unused)
- Modify: `packages/shared/src/agent/backend/factory.ts` (cleanup остаётся)
- Modify: `packages/shared/src/agent/core/pre-tool-use.ts` + `packages/server-core/src/services/privileged-execution-broker.ts` (один source of truth для admin regex)
- Test: новый `packages/server-core/src/services/__tests__/privileged-execution-broker.test.ts`
- Create: `packages/server-core/src/sources/source-index-facade.ts`
- Modify: `packages/server-core/src/handlers/rpc/sources.ts`, `packages/server-core/src/sessions/SessionManager.ts` (только import facade)

- [ ] Characterization-тест: под node `searchSourceIndex` возвращает пусто / `fts: false` — зафиксировать текущее поведение.
- [ ] Facade реэкспортирует четыре продакшн-функции без смены сигнатур; RPC и SessionManager импортируют facade.
- [ ] Admin regex живут в одном модуле; оба call site его используют; тесты брокера покрывают allow/deny/TTL/hash mismatch.
- [ ] Dead credential-cache **read** path удалён или за `if (existsSync)` без нового write.

**Verify:** `bun test packages/server-core/src/sources packages/server-core/src/services/__tests__ packages/shared/src/agent/core/__tests__`

### U1. ADR suite + baseline benches

**Blocked by:** none (лучше после U0 characterization, не обязательно).

**Files:**
- Create: `docs/specs/2026-08-12-native-substrate/{README,00-overview,01-adrs,02-corrections,03-baseline-metrics,04-roadmap,05-anti-goals}.md`
- Create: `scripts/bench/{index,journal,rpc,runner-recovery}-bench.ts`
- Create: `bench-results/` gitignored или один checked-in sample

- [ ] Suite в домашнем стиле (Doc ID, Статус, Дата, без YAML).
- [ ] `02-corrections.md` содержит E1–E10 из spec.
- [ ] index-bench гоняет 1k/5k/20k под `bun` и `node`, пишет JSON.
- [ ] Числа вписаны в `03-baseline-metrics.md` (даже если 20k упирается в MAX_FILES — это и есть метрика).

**Verify:** `bun scripts/bench/index-bench.ts` завершается; JSON содержит `filesPerSec`, `searchMs`, `ftsAvailable`.

### U2. craft-native skeleton

**Blocked by:** U1 (protocol ADR), частично U0 facade не нужен.

**Files:**
- Create: `native/Cargo.toml`, `native/crates/craft-protocol`, `native/apps/craft-native`
- Create: golden `packages/shared/src/protocol/__fixtures__/handshake.json` (и зеркало в native tests)
- Create: `packages/server-core/src/native/{supervisor,client}.ts`
- Modify: `packages/shared/src/feature-flags.ts`
- Create: `.github/workflows/native.yml`

- [ ] Handshake major mismatch → error, match → `handshake_ack` с `native:health|version|capabilities`.
- [ ] Supervisor не стартует процесс, если флаг выключен.
- [ ] После N падений супервизор перестаёт респавнить и TS идёт своим путём.
- [ ] `cargo test` + bun-тест клиента против бинаря (или mock transport в unit, integration marked).

**Verify:** `cargo test --manifest-path native/Cargo.toml` и bun-тест supervisor (флаг off → no spawn).

### U3. craft-index shadow

**Blocked by:** U2, U0 facade.

**Files:**
- Create: `native/crates/craft-index`
- Modify: facade — branch shadow/primary
- Modify: `packages/server-core/src/sources/__tests__/source-index.test.ts` — табличный прогон ts | rust

- [ ] Каналы `index:reindex|search|retrieve|count|status`.
- [ ] Shadow: оба пути, diff в лог, наружу TS-результат.
- [ ] Лимиты конфигурируемые; default совместим с 2000/32MB пока не измерен выигрыш.
- [ ] Parity suite зелёный на фикстурах текущего теста.

**Verify:** `bun test packages/server-core/src/sources` с `CRAFT_FEATURE_NATIVE_SIDECAR=1` (shadow) и без флага.

### U4. Расширение cloud-runner conformance (подготовка к rund)

**Blocked by:** none.

**Files:**
- Modify: `packages/cloud-runner/src/conformance.ts`
- Test: `packages/cloud-runner/src/__tests__/local-provider.test.ts`

- [ ] Новый кейс: kill runner → getStatus не зависает, state terminal `failed`/`runner_error`.
- [ ] Новый кейс: artifact `../` по-прежнему `path_traversal`.
- [ ] Документировать, что process-tree и budget — ещё не в suite, если не успеваем оба.

**Verify:** `bun test packages/cloud-runner/src/__tests__/local-provider.test.ts`

---

## Verification Contract

```bash
bun test packages/server-core/src/sources
bun test packages/cloud-runner/src/__tests__/local-provider.test.ts
bun test packages/shared/src/i18n          # только если добавлены строки
cargo test --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml -- -D warnings
bun scripts/bench/index-bench.ts
```

Кросс-платформа в этой среде: только Linux x64. macOS/Windows — CI self-hosted / явно unsupported.

## Definition of Done (этот план, не весь вердикт)

- [ ] Вердиктные ошибки E1–E10 записаны в ADR и больше не определяют очередь.
- [ ] Baseline JSON существует до merge Rust-index как primary.
- [ ] Facade — единственный продакшн-шов index.
- [ ] Sidecar за флагом off по умолчанию; падение sidecar не роняет Electron.
- [ ] Shadow parity на текущих source-index тестах.
- [ ] Windows не обещан в пользовательских docs.
- [ ] Нет Zig/ICN/Kotlin/Java в diff.

## Out of scope

`craft-exec`, `craft-icn`, session journal primary, MCP supervisor, RPC rewrite, extension broker, Rust CLI, Android, Swift Local Endpoint Connector как полный продукт.
