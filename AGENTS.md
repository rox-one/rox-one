# ROX — гайд для агентов и контрибьюторов

Этот файл читают кодовые агенты, работающие в этом репозитории (форк `craft-ai-agents/craft-agents-oss`), и привязан к нашей runtime-интеграции с OMP.

## Стек и воркфлоу
- Менеджер: **Bun** (`bun install`, hoisted linker из `bunfig.toml`).
- Тесты: `bun test <path>`; typecheck: `bun run tsc --noEmit` внутри пакета.
- i18n: ВСЕ user-facing строки — через `t()` из react-i18next; переводы в `packages/shared/src/i18n/locales/*.json` (12 локалей: ar, de, en, es, fr, hu, ja, ko, pl, ru, zh-Hans, zh-Hant; ru — дефолт UI-язык, `fallbackLng: ['ru','en']`). Новый ключ → все 12 файлов, ключи ASCII-сортировкой; паритет проверяется `bun test packages/shared/src/i18n`.
- Русские плюральные ключи: `_one/_few/_many`; `_other` добавляем по польской конвенции.

## OMP-бэкенд (провайдер `omp`)
Локальный агентный рантайм `omp` (oh-my-pi CLI, `--mode rpc`, NDJSON) поднят как первоклассный бэкенд:

- Реализация: `packages/shared/src/agent/omp-agent.ts` (OmpAgent extends BaseAgent).
- Протокол: `docs/omp-rpc-notes.md` (**обязательно к прочтению перед изменениями транспорта** — там критичный факт про обязательные `extension_ui_response` и shape `set_model`).
- Интеграционный статус: `docs/omp-integration-gap.md` — **v2 закрыт** (G1–G4: source proxies, thinking stream, branching, skills sync); v1-ограничения ниже сняты.
- Подключение дефолта: `storage.ts#seedDefaultLlmConnection` создаёт подключение Rox (providerType `'omp'`, authType `'none'`, defaultModel `rox/r1-max`). Единственная встроенная модель в публичном выборе — Rox R1 Max; модели отдельно подключённых провайдеров сохраняются. OMP получает auth через сохранённые ROX credentials и настроенный source profile, с отдельным managed profile для публичного ROX-каталога. `spawn_session` без `model` на ROX-родителе использует `rox/r1-max`.
- Permission mapping: craft `allow-all` ⇄ `--approval-mode yolo` (spawn-time, флип режима = респавн); `ask/safe` — диалоги `extension_ui_request`-времени проксируются в craft-пермишны.

### ROX-инструменты внутри OMP (host tools)
OmpAgent публикует craft-сессионные инструменты в OMP через `set_host_tools`:
- что: общий билдер `buildSessionToolDefs({ includePoolProxyDefs: true, includeHostBashAlias: true })` (`packages/shared/src/agent/session-tool-defs.ts`) — session tools (spawn_session, call_llm, browser_tool, mcp__session__*, **host-tool `bash`**) **плюс MCP source-proxy defs из mcpPool** (v2, G1); unprefixed `bash` shadows OMP's built-in Bash so craft spawns the process; loadMode `'essential'` — иначе инструменты «прячутся» от модели; `refreshHostToolsFromPool()` догоняет изменения пула в idle-точках (между ходами / при `setSourceServers`);
- как: OMP шлёт `host_tool_call` → OmpAgent исполняет тем же кодом, что PiAgent: source-proxy имена (`mcp__<slug>__*`) диспатчатся в `mcpPool.callTool` **до** session-registry (`executeHostSessionTool`) → `host_tool_result {content:[{type:'text',text}]}`;
- в ask/safe — перед исполнением спрашиваем у пользователя через craft permission + `respondToPermission` (120с fail-safe deny);
- Нативный resume: сохранённый active-session.json указывает на OMP-транскрипт; восстановление через проверенный switch_session выполняется до первого нового запроса.

### Thinking, branching, skills (v2)
- **Thinking stream (G2):** OMP `thinking_delta`/`thinking_complete` мапятся в `AgentEvent` и рендерятся отдельной карточкой «Рассуждение» (свёртка по complete).
- **Branching (G3):** `supportsBranching`; anchor-ивенты `omp_turn_anchor` пишутся в sidecar `meta/omp-turn-anchors.json`; `ensureBranchReady()` → `applyOmpBranchHandshake()`: fork через приватную копию родителя и нативный `fork {entryId}` на выбранном ответе; родитель не меняется. При отсутствии нативных anchors восстанавливается точный сохранённый ROX-префикс.
- **Skills sync (G4):** `packages/shared/src/skills/omp-discovery.ts` (скан `~/.omp/agent/skills`, `~/.agents/skills`, `<ws>/.omp/skills`); секция «НАВЫКИ OMP» в панели + экспорт через RPC `skills:importOmp`; @-mention активация через `extractSkillPaths`.

### Зеркалирование сессий
OMP запускается с `--session-dir <workspace>/sessions/<craftSessionId>/omp` (БЕЗ `--no-session`): транскрипт OMP лежит рядом с craft-транскриптом — история дублируется в обоих сторах, без конфликтов. При перезапуске возобновляется нативный OMP-транскрипт. Для старых сессий без него выполняется явная реконструкция сохранённой ROX-истории; повреждённый транскрипт приводит к ошибке. Отмена истории сохраняет reset-маркер.

### Runtime-контекст агента
При каждом spawn OMP получает `--append-system-prompt` с `OMP_ROX_CONTEXT_PROMPT` (в omp-agent.ts): агенту прямо сказано, что он работает внутри ROX, какие host tools доступны, что статусы/теги ведёт craft.

## Режимы и дефолты
- `workspaceDefaults.permissionMode = 'allow-all'` («Выполнение») — дефолт новых сессий; восстановленные сессии без явного режима тоже default'ся в allow-all (SessionManager.defaultRestorePermissionMode).
- Явно сохранённый пользователем режим сессии — wins.

## Как добавить новый провайдер бэкенда
1. `LlmProviderType` + `AgentProvider` + zod-enum в `packages/shared/src/config/validators.ts` (иначе ConfigWatcher пометит invalid).
2. `createBackend` case + driver registry в `backend/factory.ts`.
3. Класс extends BaseAgent с абстрактными `chatImpl/abort/forceAbort/isProcessing/respondToPermission/runMiniCompletion/queryLlm`.
4. UI: группа в `model-picker-helpers.ts`, лейбл в `AiSettingsPage`, пресет в onboarding (`ProviderChoice` + `useOnboarding.handleSelectProvider`).

## Runtime 0.11.8
- Все пользовательские, task и вспомогательные сессии проходят через OMP. Старые подключения мигрируют на настроенное OMP-подключение; смена модели отражается в состоянии сессии.
- Каждый запрос автоматически активирует `orchestrate workflowz ultrathink` и максимальный thinking. Частный runtime policy применяется после настроек проекта.
- Канонический контекст: `<config dir>/context` (по умолчанию legacy `~/.rox`, `~/rox` при флаге `storage.visible-root.v1`), либо явный `ROX_CONFIG_DIR`. Legacy-данные импортируются копированием, исходники сохраняются.
- Каталог 330 скиллов: `apps/electron/resources/skills/REQUESTED-SKILLS.json`; доказательство нативного обнаружения: `OMP-DISCOVERY.json`. Внешние инструменты и авторизация описаны отдельно от наличия скилла.
- Источники, лицензии и старые идентификаторы для безопасного импорта не переименовывать вслепую.
