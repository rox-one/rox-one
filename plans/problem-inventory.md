# Rox — полный инвентарь недочётов

Источник: аудит `plans/integration-audit.md` (2026-08-12, `main` @ `5797f431`) + remediation A–H + reviewers R1–R4 + Wave 5 (ветка `rox-integration-remediation-7c33`).

Легенда статуса:

| Статус | Значение |
|---|---|
| `FIXED` | Закрыто кодом на integration-ветке, есть регрессионные тесты |
| `OPEN` | Живой дефект / пробел в текущем дереве |
| `DEFERRED` | Сознательно отложено: нужен продукт / legal / infra, не код |
| `OPS` | Код готов, нужна операция вне репозитория |
| `HYGIENE` | Не ломает продукт, но создаёт шум и ложные сигналы |

Каждая запись: что именно сломано, где, почему это проблема, текущий статус.

---

## 1. Агентный рантайм / OMP / first-run

### 1.1 P0: зависание, если `omp` выходит до `ready` — `FIXED`

- **Было:** `handleSubprocessExit` обнулял `subprocessReadyResolve`, 20-секундный timeout никогда не срабатывал, `chatImpl` ждал `ensureSubprocess()` вечно. CLI `--validate-server` step 11 — 60 с timeout; в браузере — бесконечный spinner + `[StaleSecurity]`.
- **Причина:** ready-promise был односторонним (только resolve), exit/spawn-error/malformed/timeout не имели общего settle.
- **Фикс:** `settleReady()`, child-scoped handlers, `startupGeneration`, `teardownUnreadySubprocess`, typed codes `OMP_NOT_CONFIGURED` / `OMP_NO_MODELS` / `OMP_AUTH_REQUIRED` / `OMP_START_FAILED` / `OMP_READY_TIMEOUT` / `OMP_PROTOCOL_ERROR`.
- **Доказано:** hang-repro → typed `OMP_NO_MODELS` + idle за 23 мс; Wave 5 — bounded <1 с.

### 1.2 P0-follow-up: concurrent spawn hang — `FIXED` (R4 A1)

- Два параллельных `ensureSubprocess()` поднимали два child. Второй hang'ался на чужом ready.
- **Фикс:** мемоизация `spawnPromise`.

### 1.3 Ready-timeout без SIGKILL — `FIXED` (R4 A2)

- Timeout помечал ошибку, но child мог остаться живым и мешать следующему spawn.
- **Фикс:** SIGKILL escalation + fresh respawn.

### 1.4 Flood stderr сбивал классификацию — `FIXED` (R4 A4)

- 8 KB ring buffer вытеснял «No models available» поздним мусором → generic `OMP_START_FAILED`.
- **Фикс:** latch сигнатуры по chunk'ам, не только по хвосту.

### 1.5 Mid-turn crash без `complete` — `FIXED` (R4 A6)

- Двойной `error`, сессия могла остаться processing.
- **Фикс:** один terminal `complete` + дедуп ошибки.

### 1.6 `queryLlm` врал про модель — `FIXED`

- `omp -p` шёл без `--model`, в ответе писался `this._model`.
- **Фикс:** `--model <id>`, честный effective model / `undefined` + warning.

### 1.7 First-run не провижионит `~/.omp/agent/config.yml` — `OPEN`

- Seeded connection `rox-kimi` (`providerType: 'omp'`, `authType: 'none'`) не создаёт gateway credentials.
- Onboarding завершается «успешно», первый turn честно падает `OMP_NO_MODELS`.
- Это уже не hang, но **install → chat** на чистой машине по-прежнему не работает без out-of-band OMP/Rox credentials.
- Wave 5: stream / host tool / MCP tool / permission interaction — **BLOCKED** (нет live LLM).

### 1.8 OMP typed codes едут по проводу строками — `OPEN`

- `OmpStartupErrorCode` не влит в core union `AgentEvent` / protocol DTO.
- UI и CLI парсят строки; новый код легко потерять на границе.

### 1.9 Вложения в OMP — только текст — `OPEN`

- Картинки flatten'ятся в prompt; wire-контракт для image RPC не подтверждён.
- Паритет с Pi/Claude по multimodal не выполнен.

### 1.10 Авто-тег OMP-сессий — `OPEN` (низкий)

- Event-bus умеет `set_session_labels`; дефолтного лейбла для `providerType: 'omp'` нет.

### 1.11 Частичный tool output не стримится — `OPEN` (низкий)

- `tool_execution_update` дропается сознательно; пользователь видит tool только целиком.

### 1.12 Desktop onboarding не гоняется headless — `OPEN` (тест-долг)

- Wave 5 проверил seed + auth env, не сам UI wizard.

### 1.13 Factory скрывает OMP как unavailable — `OPEN`

- `getAvailableProviders()` возвращает только `['anthropic', 'pi']`.
- `initializeBackendHostRuntime` из-за этого не инициализирует OMP driver.
- `createBackend('omp')` и seed `rox-kimi` при этом first-class. Любой UI/тест, который верит registry, считает дефолтный бэкенд несуществующим.

---

## 2. Runtime controls (режимы / thinking / steer)

### 2.1 Дрейф дефолтов permission mode — `OPEN`

- Bundled `apps/electron/resources/config-defaults.json`: `permissionMode: "allow-all"`, cycle `["safe","allow-all"]`.
- TS fallback `FALLBACK_CONFIG_DEFAULTS` в `storage.ts`: `permissionMode: 'ask'`, cycle `['safe','ask','allow-all']`.
- Комментарий в `apps/electron/resources/AGENTS.md` врёт: «There is no TypeScript fallback».
- Headless/CI без bundled assets получает **другой** дефолт, чем desktop.

### 2.2 Legacy `thinkingLevel: "think"` в бандле — `OPEN`

- Bundled JSON всё ещё `"think"`; fallback уже `"medium"`.
- Живёт только из-за normalizer `'think' → 'medium'`.

### 2.3 Automation «permission-mode change audit» выключена — `OPEN` (продукт)

- Сидится disabled. Либо включить, либо удалить, чтобы не врать про аудит.

### 2.4 Claude steer слабее Pi/OMP — `OPEN` (документировать или выровнять)

- Claude: inject на следующем PreToolUse. Pi/OMP: native `steer`.
- UX «redirect mid-stream» на Claude не тот же контракт.

---

## 3. Viewer / share / публичный контур

### 3.1 P0: неаутентифицированные PUT/DELETE — `FIXED`

- Любой, кто знал share id, мог перезаписать/удалить шару (CORS `*`).
- **Фикс:** `ownerKey` (256-bit) → SHA-256 в R2 metadata; constant-time compare; legacy shares immutable; desktop `sharedOwnerKey` стрипается из renderer DTO.

### 3.2 UTF-16 vs bytes на size cap (R4 V3) — `OPEN`

- `JSON.stringify(body).length` сравнивается с `MAX_SHARE_BYTES` (25 MiB).
- Это UTF-16 code units, не UTF-8 bytes. Многобайтовый JSON проходит cap и раздувает R2.

### 3.3 PUT/DELETE TOCTOU + нет `nosniff` (R4 V7) — `OPEN`

- `head` → check owner → `put`/`delete` без R2 `onlyIf`/etag. Параллельный PUT может потерять апдейт (T10 в `apps/viewer/SECURITY.md`).
- GET отдаёт JSON без `X-Content-Type-Options: nosniff`.

### 3.4 Cloudflare Rate Limiting rule — `OPS`

- In-isolate limiter — best-effort. Нужно правило на `agents.rox.one/s/api*`: POST ≤30/min, PUT/DELETE ≤60/min + challenge.

### 3.5 Lifecycle legacy shares — `OPS`

- Старые объекты без `ownerkeyhash` навсегда public-read + immutable. Нужен R2 expiration / operator cleanup.

### 3.6 POST /s/api по-прежнему без аккаунта — `DEFERRED` (осознанно)

- Desktop не имеет cloud account на этом пути. Спам ограничен cap + rate limit. Аккаунт на create — отдельное продуктовое решение.

### 3.7 Viewer branding — `FIXED` (видимое) / artwork `OPEN`

- Title/header → Rox. Глиф логотипа всё ещё Craft (P6 в identity plan).

---

## 4. Безопасность (кроме viewer)

### 4.1 MCP SSE advertised, но не реализован — `FIXED`

- `transport:'sse'` больше не coerce в HTTP; есть `SSEClientTransport`.

### 4.2 `sources:getMcpTools` мимо `resolveStdioConfig` — `FIXED`

### 4.3 Утечка `ROX_SECRET_*` / `INFISICAL_TOKEN` в stdio MCP — `FIXED`

- Prefix blocklist + `INFISICAL_TOKEN`. Явный `config.env` источника всё ещё побеждает (user intent).

### 4.4 MCP follow-redirect SSRF — `FIXED`

- `createMcpGuardedFetch`: только same-origin, иначе `McpRedirectError`.

### 4.5 Credentialed MCP URLs в логах — `FIXED`

- Reject на save + strip userinfo + `formatMcpUrlForLog`.

### 4.6 `secretRefs` denylist только в setter — `FIXED`

- Enforcement в `resolveSecretsForSpawn` → `SECRET_ENVVAR_DENIED`.

### 4.7 Diagnostics секретов могли содержать raw values — `FIXED`

- `redactRegisteredSecrets` на `lastError.message`. Остаточный риск: провайдер, который эхоит значение **до** регистрации, не редактируется.

### 4.8 Гонка `refreshRuntimeSecretEnv` — `FIXED`

- Monotonic `refreshGeneration`.

### 4.9 OAuth callback `errorDetail` без escape — `OPEN`

- `packages/shared/src/auth/callback-page.ts`: `errorDetail` и `deeplinkUrl` интерполируются в HTML/JS без экранирования.
- Классический reflected XSS / open-redirect на callback page.

### 4.10 WeChat iLink — `DEFERRED` (риск продукта)

- Неофициальный personal-bot adapter. Бан аккаунта / нестабильность API.

### 4.11 Cloud-gateway: один shared bearer — `OPEN`

- `CLOUD_RUNS_TOKEN`, не craft-JWT. Любой держатель токена = все runs.

### 4.12 Secrets: нет UI, нет per-workspace scope, нет refresh-on-change — `OPEN`

- Vertical slice runtime есть. Долгие сессии держат env со spawn. Infisical: нет `list()`, нет machine-identity exchange, нет v4 API.

### 4.13 Инструменты агента видят injected secrets — `DEFERRED` (trust model)

- То же, что `runtime.envOverrides`. Не баг, но граница доверия должна быть явной в UX.

---

## 5. Knowledge / PKM / SiYuan

### 5.1 Session tools `knowledge_*` отсутствовали — `FIXED` (read-path)

- `knowledge_search` / `knowledge_read` / `knowledge_get_backlinks` на всех бэкендах.
- Underscore в wire names (Anthropic не принимает dots).

### 5.2 `knowledge_search` мог вернуть безразмерную страницу — `FIXED` (R4 K3)

- Response-side `slice(0, KNOWLEDGE_SEARCH_MAX_LIMIT)` + truncation header.

### 5.3 Navigator Inbox / Daily / Databases / Tags — `OPEN`

- Секции static-empty: нет provider contract на эти kind'ы.
- Notebooks / recent / favorites / saved views — живые после C.

### 5.4 Write-proposal tools не в registry — `OPEN` (осознанно UI-gated)

- Propose/approve/apply есть в RPC/UI, агент их не вызывает.
- Bundled skills всё ещё декларируют write-adjacent capabilities, которых нет как tools.

### 5.5 `KnowledgeAgentPanel` не смонтирован — `OPEN`

- Компонент и тесты есть; ни одна страница его не импортирует.
- CTAs «Ask about document» / «Open session» существуют только как мёртвый UI.

### 5.6 Managed SiYuan kernel — `DEFERRED` (G2 legal OPEN)

- `mode: 'managed'` fail-closed. Не бандлить и не скачивать kernel, пока нет OEM/AGPL решения.

### 5.7 Rail `notes` игнорирует migration map — `OPEN`

- P4.4 миграция есть; старые deep links `notes` не редиректят в SiYuan id.

### 5.8 Нет live-kernel CI — `OPEN` (тест-долг)

- 154+ knowledge тестов мокают kernel. Регресс HTTP-контракта SiYuan не ловится.

### 5.9 Write whitelist узкий — `DEFERRED` (безопасность)

- Только `createDocWithMd`, `appendBlock`, `updateBlock`, `setBlockAttrs`. Расширять только с mutation-safety spec.

---

## 6. Sources / MCP / leftover servers

### 6.1 `session-mcp-server` / `bridge-mcp-server` / `McpPoolServer` — `OPEN` (LEGACY)

- Собираются, стейджатся, резолвятся в `runtime-resolver.ts`.
- Ни один из трёх живых бэкендов (`anthropic`/`pi`/`omp`) их не спавнит (`needsHttpPoolServer: false`).
- Платят размер релиза и путают агентов («это ещё нужно?»).

### 6.2 OAuth client IDs для Google/Slack/Microsoft — `OPEN`

- Packaged OAuth требует env на build/run. Не задокументировано как release gate.
- Relay всё ещё `https://agents.craft.do/auth/*`.

### 6.3 Нет stdio MCP spawn e2e — `OPEN` (тест-долг)

- Нормализация покрыта; реальный spawn child + tool call — нет (кроме proxy-chain с fakes).

### 6.4 Env blocklist дублируется — `OPEN` (hygiene)

- `mcp/client.ts` и `session-tools-core/.../sandbox-env.ts`. Расхождение уже один раз дало дыру.

### 6.5 `proxy-tool-name.ts` не портирован с upstream — `OPEN` (hygiene)

- Логика inline в `mcp-pool.ts`. `packages/shared/CLAUDE.md` ссылается на файл, которого нет.

---

## 7. Identity / white-label

### 7.1 User-visible Craft leftovers первой волны — `FIXED`

- login.html, viewer header, RoxConnectStep i18n, titles, «Rox Backend», callback `<title>`.

### 7.2 MIGRATE-класс (12 пунктов) — `OPEN`

См. `plans/identity-migration-plan.md`. Ни один не начат:

| ID | Что | Почему нельзя «просто переименовать» |
|---|---|---|
| F1–F3 | `~/.craft-agent` / `CRAFT_CONFIG_DIR` | Страдает каждый существующий install |
| E1 | ~40 `CRAFT_*` | Сотни call sites; нужен resolver + deprecation |
| D1 | `craftagents://` | Юзерские Shortcuts/скрипты |
| A1–A2 | `com.lukilabs.craft-agent` / `productName` | Ломает auto-update, Keychain, TCC |
| A3 | iOS bundle ids | Новый App Store app |
| P1–P3 | OAuth relay + electron publish URL | Чужой infra + third-party consoles |
| P6 | ASCII `CRAFT_LOGO` | Нет Rox wordmark |
| N1 | `@craft-agent/*` | Repo-wide codemod |
| O1 default | `clientId: 'craft-agents-desktop'` | Контракт с private website |
| L3 | README/TRADEMARK/NOTICE | Legal review |
| L5 | System prompt «You are Craft Agent» + `agents-noreply@craft.do` | Persona / prompt regression |

### 7.3 Мёртвый ReauthScreen (U12) — `OPEN` (hygiene)

- `handleReauthLogin` — placeholder. Строки про «Craft session expired».

### 7.4 Два account switcher'а — `OPEN`

- Rox Connect gate параллелен Identity Center. Spec S-07: «no two account switchers».

### 7.5 `fetchRoxBalance` без UI — `OPEN`

- API есть, экрана нет.

### 7.6 Website repo недоступен — `DEFERRED`

- `rox-one/rox-one-website` 404 из этой среды. Device flow / billing / cabinet не аудируются.

---

## 8. Collections / Unified Shell

### 8.1 FR-11 filters persistence — `FIXED`

### 8.2 FR-45 list LexoRank drag — `FIXED`

### 8.3 Grouping reconciliation + duplicate bulk UI — `FIXED`

### 8.4 `PanelHost` — `FIXED` (каркас) / пустые contributions — `OPEN`

- Вердикт G: **KEEP_EXPERIMENTAL**.
- `featureUnifiedShellAtom` default OFF.
- Inspector — stubs. Ноль реальных panel contributions.
- Dock→panel mapping плагинов SiYuan ждёт живых панелей.

### 8.5 Theme-as-extension-runtime (S-05) — `OPEN`

- Тип темы в extension runtime пустой.

### 8.6 Omnibox: неполный prefix set + слабый federated SiYuan search — `OPEN`

### 8.7 pdfjs `?url` — 3 падающих теста — `OPEN` (pre-existing)

- Доказано на base `5797f431`. Не регрессия remediation, но suite красный.

### 8.8 Column resize/reorder persistence, CSV export — `DEFERRED` (PRD)

### 8.9 Generic collection engine `packages/ui-collections` (K-09) — `NOT_STARTED`

- Третий движок коллекций рядом с Linear-views и Filtrex `views.json`.

### 8.10 Два query DSL на один список сессий — `OPEN`

- Smart views: Filtrex над `views.json`.
- Collection chips: императивный `filterSessionMeta` над `collection/filters.json`.
- `AppShell` AND-ит оба контура. Expansion потомков лейблов продублирован (`matchesLabelFilter` vs ручной код в AppShell). Due-диапазоны и `dueBucket` могут расходиться.

---

## 9. Remote / cloud / messaging / iOS

### 9.1 WebUI `manifest.json` за auth → 401 — `OPEN`

- PWA warning в консоли. Косметика, но ломает installability.

### 9.2 `notification:getEnabled` нет в web adapter — `OPEN`

- `AppSettingsPage` спамит «No handler» в webui.

### 9.3 Rox Connect LOCAL_ONLY — `OPEN` / `DEFERRED`

- Headless/webui/iOS не регистрируют каналы. Для web это может быть правильно, но gate `ROX_CLOUD_REQUIRED` на desktop без website — hard block.

### 9.4 `Dockerfile.server` без Discord worker — `OPEN`

- WhatsApp worker есть, Discord dist нет. Контейнер врёт про messaging parity.

### 9.5 Cloud-gateway F17/F18/F21 — `OPEN`

- F17 nightly CI secrets, F18 E2B provider, F21 omp-runner parked (lazy-install wall-clock).

### 9.6 Modal runner parity с CF `runner.mjs` — `OPEN`

- Нет Python unit tests in-tree.

### 9.7 iOS — `PARTIAL`

- Нет APNs, нет sources UI, Craft-named, нет CI signing. Linux-аудит не собирал.

### 9.8 Messaging package description stale — `HYGIENE`

- «Telegram & WhatsApp», фактически +Discord/Lark/WeChat.

---

## 10. Artifacts / design

### 10.1 `dashboard.html` orphan — `OPEN`

- 594 issues / 267 PRs snapshot, ноль ссылок, не билдится, Craft-branded.

### 10.2 Design canvas — `NOT_STARTED`

- Нет excalidraw/tldraw. Ближайшее — mindmap / mermaid / HTML preview.

### 10.3 Нет first-class Artifact entity — `DEFERRED` (продукт)

- «Artifact» в коде = tarball / cloud-run output, не chat entity.

---

## 11. Secrets / toolchain / marketplace

### 11.1 Infisical-as-secrets-backend был NOT_STARTED — runtime slice `FIXED`

- Осталось: UI, list(), machine identity, v4, per-workspace scope, refresh watcher.

### 11.2 `oh-my-openagent` заблокирован unpublished dep — `OPEN`

- Задокументировано в toolchain manifest.

### 11.3 Marketplace/runtime-context PRD всё ещё «draft» — `HYGIENE`

- Код shipped.

---

## 12. Docs / repo hygiene / CI

### 12.1 AGENTS.md / omp-gap / omp-agent header / cli.md / README clone URL — `FIXED` (H)

### 12.2 Мёртвые scripts `marketing:*` / `docs:dev` / `CRAFT_WEBUI_PORT` — `OPEN`

- См. `docs/repo-known-issues.md`. `CRAFT_WEBUI_PORT` никто не читает.

### 12.3 Root `tsc --noEmit` сломан — `OPEN`

- Root tsconfig без inputs. Скрипт врёт «typecheck».

### 12.4 `CRAFT_SERVER_TOKEN` <16 символов — fatal — `HYGIENE` (задокументировано R1)

- Runbooks с коротким токеном падают на boot. Не хватает упоминания в `docs/cli.md` / README.

### 12.5 Config-dir single-instance lock — `HYGIENE` (задокументировано R1)

- Второй процесс на тот же `CRAFT_CONFIG_DIR` отказывается стартовать. Скрипты рестарта должны сначала убить старый PID.

### 12.6 85 rox + 9 donor веток SAFE_TO_DELETE — `OPS`

- Команды в `plans/branch-disposition.md` §5. Не удалять без review.
- Donor `feat/shell-ext-activate2`: уникальный тест `worker-list-commands.test.ts` (142 строки) — port или discard.

### 12.7 Нет `.cursor/environment.json` на integration — `OPEN`

- Есть на `cursor/rox-program-p0-archaeology-env-a5eb` (PR #3). Cloud VM ставит Bun руками.

### 12.8 `integration-audit.md` жил только на PR #2 — `FIXED` этим коммитом

- Восстановлен на planning-ветке, чтобы инвентарь имел первоисточник.

---

## 13. Архитектурные недостатки (не баги, а цена изменений)

Эти пункты не «сломано сейчас», а почему следующий цикл снова упрётся в одни и те же файлы.

### 13.1 `SessionManager.ts` — 10 064 строки, god-module

- Share owner key, spawn, permissions, knowledge hooks, collection fields, event projection — всё в одном файле.
- Ownership map remediation **запрещал** параллельные правки. Любая новая фича снова сериализуется через этот файл.

### 13.2 `config/storage.ts` — 3 559 строк

- Defaults, env overrides, secret fragment, seeding, watchers. Именно здесь живёт дрейф `FALLBACK_CONFIG_DEFAULTS`.

### 13.3 `omp-agent.ts` — 2 254 строки

- Lifecycle, NDJSON protocol, host tools, branching, permissions, one-shot completions. Lifecycle уже углублён, но seam не выделен: тесты тащат весь класс.

### 13.4 Двойные системы (семь пар)

| Пара | Цена |
|---|---|
| Classic AppShell vs Unified Shell | Два layout path, флаг OFF, PanelHost пустой |
| Rox Connect vs Identity Center | Два account UX |
| Legacy Notes vs SiYuan Knowledge | Два навигатора, сломанный rail redirect |
| Linear collections vs Filtrex views vs K-09 spec | Три модели фильтров |
| `credentials.enc` vs `secrets/` providers | Два секретных контура |
| In-process MCP vs leftover stdio servers | Мёртвый staging |
| Craft identifiers vs Rox identifiers | Двойной язык в env/docs/prompts |

### 13.5 Мелкие shallow-module

- `McpPoolServer`, `session-mcp-server`, `bridge-mcp-server` — adapters без второго живого потребителя (один adapter = hypothetical seam).
- OMP/Pi/Claude drivers: omp driver — no-op; сложность в `OmpAgent`, не за seam'ом factory.

---

## Сводка счётчиков

| Класс | Кол-во (прибл.) |
|---|---|
| P0/P1 закрыто remediation | 21 |
| OPEN дефекты / пробелы, которые можно закрыть кодом | 38 |
| OPS (dashboard / R2 / branch delete) | 4 |
| DEFERRED (legal / product / trust) | 9 |
| HYGIENE | 8 |
| Архитектурные deepening (не баги) | 5 крупных |

P0, которые **ещё открыты:** нет. Самый дорогой OPEN: first-run credentials (1.7) + factory скрывает OMP (1.13) + OAuth callback XSS (4.9) + viewer V3/V7 (3.2–3.3) + KnowledgeAgentPanel unmounted (5.5) + SessionManager god-module (13.1).
