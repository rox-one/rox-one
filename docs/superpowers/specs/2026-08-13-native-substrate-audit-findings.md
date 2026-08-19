# Native substrate — аудит вердикта против кода

- **Doc ID**: N-AUDIT
- **Статус**: draft
- **Дата**: 2026-08-13
- **Входные документы**: вердикт «TypeScript control plane / Rust native substrate / Zig leaf / Swift Apple / Kotlin Android / Java nowhere»; план `native substrate slice`
- **Связанные документы**: [N-PLAN workstreams](../plans/2026-08-13-native-substrate-workstreams.md), [N-PROMPT](./2026-08-13-native-substrate-agent-prompt.md), [toolchain download manager](./2026-08-06-toolchain-download-manager-design.md), [iOS CraftAgentKit design](./2026-07-11-ios-ipados-native-client-design.md), [cloud-runs PRD](../../cloud-runs-prd.md)
- **Репозиторий**: agisota/craft-agents-oss (форк craft-ai-agents/craft-agents-oss)
- **Метод**: сверка каждого утверждения вердикта с HEAD `5797f431` на `main`. Независимые проходы по index / exec / runner / MCP / protocol / packaging.

---

## 1. Что вердикт угадал

Цифры и крупные факты совпадают с деревом:

| Утверждение | Факт в HEAD |
|---|---|
| SessionManager ~434 КБ | `packages/server-core/src/sessions/SessionManager.ts` — 433 753 B |
| browser-pane-manager ~150 КБ | `apps/electron/src/main/browser-pane-manager.ts` — 150 494 B |
| CLI `index.ts` ~76 КБ | `apps/cli/src/index.ts` — 75 673 B |
| pi-agent-server ~72 КБ | `packages/pi-agent-server/src/index.ts` — 72 167 B |
| Swift ~257 КБ | 82 файла, 256 668 B |
| TS+TSX ~18 МБ | 1601 `.ts` + 473 `.tsx` = 18.1 МБ |
| Rust / Zig / Kotlin = 0 | ни одного файла |
| Source index: sync walk, 2000 файлов, 32 МБ | `MAX_FILES = 2000`, `MAX_TOTAL_BYTES = 32 * 1024 * 1024`, `readdirSync`/`readFileSync` |
| Memory FTS отключается вне Bun | lazy `require('bun:sqlite')`, без фолбэка |
| Knowledge watcher — таймер, не FSEvents | `setInterval`, default 60_000 ms, sync JSON state |
| Local runner: `state.json` / `events.jsonl` / `runner.pid` / SIGTERM→SIGKILL | `packages/cloud-runner/src/local-provider.ts` |
| CLI readiness: grep `CRAFT_SERVER_URL=` | `apps/cli/src/server-spawner.ts` |
| Swift зеркалит TS вручную | комментарии в `CraftAgentKit` + design doc |
| Extension host — utility process + capability broker | `apps/electron/src/main/extension-host-manager.ts` |
| Android-приложения нет | `apps/` не содержит android |
| Java в runtime нет | OpenJDK есть в среде, в репо — 0 `.java` |

Это хорошая основа **не** для rewrite, а для strangler по процессным границам. Ниже — всё, что вердикт сказал неточно, пропустил или поставил в неверную очередь.

---

## 2. Ошибки вердикта (ложные утверждения)

### E1. `PrivilegedExecutionBroker` — security boundary

Вердикт описывает его как ядро исполнения. В коде это **только** in-memory approval + JSONL-аудит. Класс сам говорит: «Execution itself is delegated to backend tool execution paths». Политика — три regex (`brew install --cask`, `brew upgrade --cask`, `installer -pkg`). Approvals живут в `Map` и пропадают при рестарте. Дубль классификации — `classifyAdminApproval` в `packages/shared/src/agent/core/pre-tool-use.ts`. Тестов на брокер нет.

Агентский Bash исполняется **внутри** Claude CLI / Pi / OMP. Craft его не спавнит. `craft-exec` не может перехватить Bash, пока Bash не станет host tool. Для OMP/Pi это возможно (`set_host_tools`). Для Claude Code CLI — нет: SDK спавнит нативный `claude`.

**Следствие:** `craft-exec` — не P0. Это P1 с TS-предусловием.

### E2. MCP пишет расшифрованные credentials на диск

Вердикт строит PR-031 вокруг `.credential-cache.json`. Writer удалён из HEAD. Живой путь: AES-256-GCM `~/.craft-agent/credentials.enc` → decrypt in memory → `Authorization: Bearer` в `McpClientPool`. Остались мёртвые readers (`packages/session-mcp-server/src/index.ts`, бандл `apps/electron/resources/bridge-mcp-server/index.js`) и cleanup в `packages/shared/src/agent/backend/factory.ts`.

**Следствие:** «убрать plaintext cache» — это удаление мёртвого TS, не Rust-супервизор.

### E3. «Нужен новый native RPC»

`packages/shared/src/protocol/types.ts` уже содержит `MessageEnvelope`, `PROTOCOL_VERSION = '1.0'`, major-version handshake, `clientCapabilities`, `seq`/`lastSeq` replay, chunked `transfer:*`. Unix-сокета нет — транспорт сегодня WebSocket NDJSON. Sidecar должен говорить **тем же конвертом** по UDS/named pipe, а не изобретать второй протокол.

### E4. Канонические контракты живут в `packages/core`

Вердикт предлагает снимать схемы с `packages/core`. Проводные DTO — `packages/shared/src/protocol/dto.ts`. `packages/core` — persistence-типы, более узкие. Swift уже зеркалит `dto.ts`, не core.

### E5. «Поиск чисто лексический»

Source-index и memory FTS — лексика (FTS5 BM25 / LIKE). Episodic memory (`packages/server-core/src/memory/episodic-memory.ts`) — embeddings `Xenova/all-MiniLM-L6-v2` за `memory.semantic` (default false), иначе Jaccard. Rust-индекс должен явно решить: поглощает episodic или нет.

### E6. `session-mcp-server` — живой MCP path

Вердикт описывает stderr `__CALLBACK__` как текущий протокол. Протокол в файле есть. Ни Claude, ни Pi, ни OMP этот сервер не спавнят. `needsHttpPoolServer: false` у всех бэкендов — `McpPoolServer` не стартует. Живой путь: in-process `McpClientPool`.

### E7. Knowledge watcher — кандидат в `craft-index`

Это polling провайдера (`search`/`get`) + JSON state, не filesystem crawl. Класть его в тот же sidecar, что source FTS, — смешение bounded contexts.

### E8. `craft-icn` — «перенос текущего inference»

Отдельного local-inference lifecycle нет. Есть model resolution, Pi agent server, fetchers, onnxruntime для episodic. ICN — **новый** продукт, не extract. P0 strategic без существующего шва.

### E9. Доставка native-бинарника через Electron `extraResources`

В репо уже есть toolchain download manager: omp/ffmpeg/pandoc качаются в `~/.craft-agent`, чтобы не раздувать и не нотаризовать бандл. `craft-native` должен ехать этим путём.

### E10. DoD «macOS arm64/x64 + Windows x64 + Linux x64» выполним сейчас

CI: self-hosted mac + linux, GH-hosted матрица заблокирована биллингом, Windows-раннера нет, Rust в CI нет, `server:build` не собирает Windows. DoD вердикта сегодня невыполним.

---

## 3. Недочёты вердикта (дыры, не ложь)

- Нет A/B с дешёвой альтернативой: Electron FTS лечится драйвером SQLite (`better-sqlite3` / `node:sqlite`), не обязательно Rust.
- Нет измерения. `packages/shared/src/utils/perf.ts` — opt-in, не harness. «3× throughput» не на чем доказать.
- Conformance `cloud-runner` не покрывает crash-resume, `budget_exceeded`, process-tree kill, usage ledger. Новый Rust provider пройдёт suite и останется слабее PRD.
- `LocalSubprocessProvider.cancel` шлёт SIGTERM **pid из файла**, не process tree. `pidAlive` = `process.kill(pid, 0)`.
- E2B есть в enum/settings, `makeProvider` падает в local. Modal — subclass Cloudflare с другим `providerId`.
- Path validation размазана минимум по шести модулям.
- Env scrubbing дублируется: `sandbox-env.ts`, MCP `client.ts`, `buildClaudeSubprocessEnv`, extension `buildScrubbedWorkerEnv`, `setRuntimeEnvOverrides`.
- `FEATURE_FLAGS` живут в `packages/shared/src/feature-flags.ts`. `apps/electron/src/shared/feature-flags.ts` — пустой stub `{}`.
- `StoredConfigSchema` (zod) не валидирует многие флаги (`enable1MContext` и др. — только TS-интерфейс).
- Нет JSON Schema / protobuf / codegen. Swift и будущий Rust/Kotlin — ручные зеркала.
- Electron по умолчанию **in-process** `bootstrapServer`, не sidecar. Thin-client (`CRAFT_SERVER_URL`) — уже существующий шов.
- `scripts/build.ts` и `scripts/upload.ts` отсутствуют, но на них ссылаются `package.json` и `build-dmg.sh`.
- ASAR выключен. Native `.node` (sharp, koffi, onnxruntime) уже в бандле.
- Zig в среде не установлен. Вердикт предлагает 2–4 Zig-компонента в v1 без toolchain.
- `llama-shim` / ICN не имеют существующего C/C++ backend в репо.
- Session journal: JSONL + persistence-queue уже есть; нет checksum/compaction/crash-recovery тестов как DoD.
- Agent Bash: нет craft-side caps на stdout/память. Единственный реальный sandbox craft — `script_sandbox` (5–15 с, 20k chars).

---

## 4. Проблемы кода (независимые от вердикта)

Это то, что аудит нашёл в HEAD, даже если не переписывать ничего на Rust.

### 4.1. Index / search

- Полный sync walk на event loop сервера при `sources.REINDEX` и при spawn сессии (`retrieveSourcesForPrompt`).
- Жёсткие потолки: 2000 файлов, 512 КБ/файл, 32 МБ суммарно, 200k chars body. Большой workspace молча truncated.
- Нет инкрементальности: каждый reindex — полный обход.
- Нет FS watcher на source folders.
- Два отдельных `bun:sqlite` lazy-require (source-index и fts-index) с одинаковым fail-soft.
- Под Electron/Node поиск источников возвращает пусто, memory FTS — `null` → recency. Продукт деградирует без ошибки в UI.
- Retrieve на spawn сессии синхронный; при большом индексе задерживает старт агента.

### 4.2. Execution / permissions

- Security boundary = policy в TS + разнородные spawn-сайты. Нет единого kernel.
- Approvals privileged-команд не персистятся.
- `adminRememberApprovals` в SessionManager — ещё один in-memory Map, TTL 60 мин, max не формализован как контракт.
- Claude subprocess **намеренно** сохраняет API keys в env (нужны бэкенду).
- Нет cgroups / job objects / sandbox profile на агентский Bash.
- Duplicate admin regex в двух пакетах — drift гарантирован.

### 4.3. Cloud runner

- Доверие pid-файлу.
- Polling `events.jsonl` каждые 100 ms.
- Watchdog wall-clock есть; token/artifact budgets на local provider не доведены до того же уровня, что wall-clock.
- Stub runner resume через `done.marker` — конвенция PRD, conformance её не проверяет.

### 4.4. SessionManager

- 434 КБ, импортирует transport, browser, FS, backends, config, memory, sources, credentials, MCP, skills, labels, statuses, automations, knowledge, cloud runs.
- Это god object. Перенос «как есть» на Rust повторит тот же комок на другом языке.
- Шов для source retrieve — один статический import + fail-soft try/catch. Это удачный узкий шов.
- Остальные concerns не имеют портов.

### 4.5. MCP

- Нет periodic health, нет restart-on-crash, нет connection quotas, нет protocol-level cancel для stdio mid-call.
- Max message size — эвристика ~12k tokens post-result (`guardLargeResult`).
- Stdio: newline-delimited JSON-RPC (не LSP Content-Length) — это уже документировано и тестируется.
- `session-mcp-server` и bridge-бандл — мёртвый вес в упаковке.

### 4.6. Protocol / clients

- iOS CraftAgentKit — MVP-подмножество полей (`Workspace` = id+name). Drift со Swift неизбежен без codegen.
- Electron chunked RPC — отдельный путь ≥5 МБ, 2 МБ чанки, SHA-256. Sidecar должен либо переиспользовать, либо явно не поддерживать large transfer в v1.

### 4.7. Packaging / CI

- Нет compile-матрицы native.
- Server dist не собирает Windows.
- Release helper минимальный; исторический upload-скрипт удалён.
- Первый-запуск toolchain — правильный прецедент для sidecar.

---

## 5. Что вердикт правильно запретил

Не переписывать: React UI, `packages/core` целиком, Browser/CDP, Claude/Pi adapters, tool definitions, messaging adapters, image glue (`sharp` уже native), полный отказ от Electron, SessionManager «один в один» на Rust, Kotlin Multiplatform «на вырост», Java desktop/Spring.

Эти запреты остаются в силе.

---

## 6. Пересмотренная очередь

| Очередь | Что | Почему сдвинулось |
|---|---|---|
| **Сначала, на TS, дёшево** | Удалить credential-cache readers; SQLite driver A/B; вынести SourceIndex facade; развязать admin-regex duplication | Высокий рычаг, нулевой новый runtime |
| **P0 native** | `craft-native` skeleton + `craft-index` за флагом + shadow | Два продакшн-колсайта, измеримый выигрыш |
| **P0-adjacent native** | `craft-rund` как второй adapter `CloudRunProvider` | Контракт и conformance уже есть |
| **P1** | Session journal; SessionManager ports; `craft-exec` после host-tool Bash | Нужны предусловия |
| **P2 / по метрикам** | MCP supervisor, RPC transport, extension broker, Rust CLI | Живой MCP уже in-process; RPC latency << LLM |
| **Не в v1** | Zig, ICN, Android/Kotlin, Java, полный Swift desktop | Нет шва / нет toolchain / нет продукта |

Zig в первой версии: **ноль компонентов**. `hwprobe` — Rust crate, когда появится ICN. `sandbox-spawn` — когда разблокируется `craft-exec`.
