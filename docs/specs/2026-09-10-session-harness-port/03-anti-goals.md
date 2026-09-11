# H-03. Анти-цели порта DSH → Rox

- **Doc ID:** H-03
- **Наследует:** [S-10](../2026-08-07-unified-shell/10-anti-goals.md), UEW §2, ADR-0001, ADR-0019

Дополнительные запреты именно этой программы. Нарушение = блок ревью, не «потом поправим».

## ✗ 1. Второй агентный рантайм

Запрещено: процесс `dsh`, Cordis host внутри Electron, `npx @deepseek-ai/dsh`, общий `~/.dsh` как store сессий Rox.

Детектор: grep `dsh-better-sidebar`, `@deepseek-ai/dsh`, `~/.dsh` в `apps/` `packages/` вне `docs/`.

Альтернатива: OMP + существующий `AgentBackend`.

## ✗ 2. npm-зависимость `dsh-*` в приложении

Запрещено: любая запись в `package.json` / `bun.lock` на пакеты с префиксом `dsh-` / `@dsh-` / `@deepseek-ai/dsh`.

Детектор: `rg '"dsh-|@dsh-|@deepseek-ai/dsh' package.json apps/*/package.json packages/*/package.json`.

Альтернатива: first-party код под Apache-2.0 репозитория.

## ✗ 3. Третий workbench

Запрещено: новая оболочка «как DSH» рядом с Suite S и UEW. Запрещено тащить `node-pty` в renderer, пока UEW не выбрал владельца PTY (UEW G1).

Альтернатива: Inspector tabs + UEW `kind:'terminal'`.

## ✗ 4. Копипаст DOM/бандла community-плагина

Запрещено: vendor `node_modules/dsh-*` в asar, инъекция их `client.js` в renderer.

Альтернатива: переписать UX на Craft components.

## ✗ 5. Сетевой MITM-прокси как permission-rules DSH

На Desktop `dsh-permission-rules` слушал `127.0.0.1:63531` и резал github.com (`ECONNRESET`). В Rox это **MUST NOT** повторяться.

Альтернатива: declarative `permissions.json` + существующий fail-closed PreToolUse (RX-DOC-0031).

## ✗ 6. Секреты и цены в renderer

Запрещено: каталог API-ключей, DSN, цены моделей, захардкоженные combo id. Brandbook: missing live inventory → «live не проверено».

Альтернатива: Infisical / fabric broker; `tokenUsage` с сервера.

## ✗ 7. Open через Terminal.app / `.command`

Операторский контракт: интерактивный терминал — cmux. Команда «открыть в редакторе» **MUST NOT** вызывать `open -a Terminal`.

## ✗ 8. Смена default permission на более слабый ради паритета с DSH

Desktop DSH у оператора стоит `danger-full-access`. Rox уже `allow-all` для новых сессий. Новые пути UEW **MUST** нести явный `ExecutionPolicy` (UEW §2.12). Не размазывать YOLO на terminal/PTY «потому что в DSH так».

## ✗ 9. H6 freeze — не устанавливаем

Эти runtime **MUST NOT** появиться в Rox. Список заморожен: нет «потом возьмём». Appearance → Workbench показывает ту же таблицу как «не устанавливаем».

| id | Пакет-референс | Почему skip | Что уже есть в Rox |
|---|---|---|---|
| `sessionBuddy` | `dsh-session-buddy` | Ломал клиент | OS-notify H2 |
| `mnemon` | `dsh-mnemon` | Требовал `webServer` | `packages/server-core/src/memory/` |
| `pluginHotReload` | `dsh-hot-reload` | Cordis HMR; Desktop всё равно рестартил | флаги + RPC refresh |
| `agentTeamsRuntime` | `@nanmicoder/dsh-agent-teams` | Чужой host (Cordis). **Не** ставим npm-плагин в Rox | `SessionFanOutSheet` + `spawn_session`; opt-in first-party skill `@agent-teams` за `workbench.harness.agentTeams` (default false) |
| `visionCliPlugin` | `@liustack/modlens` | Отдельный CLI | vision-модели + `browser_tool` |
| `searchCliPlugin` | `@liustack/modsearch` | Ключи в плагине | MCP/API sources |
| `extraAutomationRuntime` | `@michengai/dsh-automation` | Тот же `webServer` | first-party automations |
| `remoteControlCompat` | Desktop remote control | Нет цели | — |


**Исключение (не runtime):** first-party skill `rox-harness/agent-teams` + флаг `workbench.harness.agentTeams` — это не установка Cordis-пакета и не второй оркестратор. Skip-list по-прежнему запрещает `@nanmicoder/dsh-agent-teams` как host runtime.

Канон в коде: `packages/core/src/platform/workbench/harness-skip-list.ts`.

**Post-H6 durable store (2026-09-11):** workspace `.agent-teams/` via `AgentTeamsStore` (`@craft-agent/core/platform/agent-teams`). Flag remains default false. Cordis `agentTeamsRuntime` stays skipped. No Timeline / inspector DAG in this follow-up.
