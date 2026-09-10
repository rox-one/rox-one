# ADR-0019: Порт возможностей DSH-harness в Rox, без второго рантайма

- **ID:** `RX-ADR-0019`
- **Status:** Accepted for planning (implementation behind `workbench.harness.*`)
- **Date:** 2026-09-10
- **Branch:** `rox/session-harness-port`
- **Does not replace:** [ADR-0001](./0001-rox-workbench-convergence.md), Suite S, UEW (`docs/specs/2026-08-25-unified-execution-workbench/` on `origin/main`)
- **Spec:** [RX-SPC-0021](../../specs/2026-09-10-session-harness-port/README.md)

RFC 2119: MUST / MUST NOT / SHOULD / MAY.

## Context

На машине оператора установлен community **DSH Desktop 2.0.9** с набором community-плагинов DeepSeek Harness (сайдбар, plugin manager, cost meter, skills/MCP panel, context dashboard и т.д.). Запрос: влить эти *фичи* в [rox-one/rox-one](https://github.com/rox-one/rox-one), аккуратно, в отдельной ветке.

Rox уже является агентной оболочкой (форк Craft Agents) с тремя контурами, которые эти фичи обязаны использовать, а не дублировать:

1. **Unified Shell (Suite S)** — слоты, `SurfaceRegistry` / `PanelRegistry`, Extension Center, анти-цели S-10.
2. **Unified Execution Workbench (UEW)** — `ExecutionCoordinator`, first-class terminal, `ExecutionPolicy`. Спека на `origin/main`. Инвариант UEW §2.1: **нет второго агентного рантайма**.
3. **Существующий продукт Craft/Rox** — сессии, skills, MCP sources, automations, notes, annotations, superpowers, notifications, OMP backend, tokenUsage, permissions.

DSH-плагины — npm-пакеты под Cordis. Этот Desktop-хост уже показал несовместимость (`SessionLogOffset`, `client-modules missed the module table`, `webServer without inject`). Перенос пакетов 1:1 в Electron main запрещён анти-целью S-10.4.

## Decision

1. **Портируем возможности, не пакеты.** Ни один `dsh-*` npm-пакет, Cordis loader, `~/.dsh` и DSH Desktop **MUST NOT** попасть в runtime Rox.
2. **Один агентный контур.** Исполнитель остаётся OMP / существующий `AgentBackend`. DSH loop **MUST NOT** встраиваться рядом с чатом Rox.
3. **Один chrome.** Новые панели регистрируются в `PanelRegistry` / `SurfaceRegistry` / Extension Center как `craft-native` или `skill-pack` / `mcp-source` / `automation-pack`. Второй rail, вторая палитра, второй AI-чат **MUST NOT**.
4. **UEW владеет терминалом.** Вкладка Terminal из DSH-сайдбара отображается на UEW `SurfaceTab.kind = 'terminal'` (основная поверхность), **не** как `RightSidebarPanel` и не как xterm внутри пузыря чата. PTY — native-crate (UEW G1), не `node-pty` в renderer.
5. **Реализация — волнами H0–H6** на ветке `rox/session-harness-port`, каждая волна — отдельный PR за флагами `workbench.harness.*` (default **false**).
6. **Доменное состояние не в Jotai.** Следуем ADR-0001 §9: UI читает RPC/проекции.

## Rejected alternatives

| Вариант | Почему нет |
|---|---|
| Встроить DSH Desktop / `dsh web` iframe в BrowserPane | Второй shell + второй агент. S-10.1–3, UEW §2.1. |
| Девятый `ExtensionRuntime = 'dsh-cordis'` | Смена схемы S-05 fail-closed; пакеты не живут на нашем Electron host. |
| Скопировать исходники community-плагинов в `apps/electron` | Чужой Cordis API, mixed licenses, код в trusted main. S-10.4, S-10.6. |

## Consequences

- Каждая DSH-фича получает строку в карте [01-capability-map.md](../../specs/2026-09-10-session-harness-port/01-capability-map.md): `reuse` / `extend` / `port` / `skip`. Хост Desktop и импорт — [04-calm-migration.md](../../specs/2026-09-10-session-harness-port/04-calm-migration.md).
- Новые строки UI — i18n × 10 локалей (`packages/shared/src/i18n`).
- H1 (инспектор сессии) **MUST** сначала влить UEW-спеку с `origin/main`, иначе появится третий workbench.
- Rollback волны: флаг off. Обратной миграции схемы в H1–H3 нет.

## Rollout

Protected by:

| Flag | Default | Волна |
|---|---|---|
| `workbench.harness.inspector.v1` | false | H1 |
| `workbench.harness.chat-chrome.v1` | false | H2 |
| `workbench.harness.agent-intel.v1` | false | H3 |
| `workbench.harness.ext-center.v1` | false | H4 |

Существующие `featureUnifiedShellAtom` и `workbench.terminal.v1` / `execution.coordinator.v1` остаются независимыми.
