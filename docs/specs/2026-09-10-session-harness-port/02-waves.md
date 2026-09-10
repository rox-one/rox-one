# H-02. Волны реализации H0–H6

- **Doc ID:** H-02
- **Ветка:** `rox/session-harness-port` (уже создана от `rox/ru-codex-navigation` @ `b61b56f`)
- **Правило:** одна волна = один PR. Флаг default false. i18n × 10. Без `dsh-*` в `package.json`.

```
H0 spec/ADR/flags ──► merge UEW docs from origin/main
         │
         ▼
        H1 inspector (files/git/term/browser)
         │
         ├────────► H2 chat chrome (parallel after H1 types land)
         │
         ├────────► H3 agent intel (needs H1 inspector slot)
         │
         └────────► H4 extension center (parallel with H2)
                      │
                      ▼
                     H5 import / advisor / simplify / workflow
                      │
                      ▼
                     H6 skip-list freeze + closeout
```

H2 и H4 независимы после H0. H3 зависит от слота инспектора (H1). Терминал в H1 — **заглушка-surface**, живой PTY только после UEW M3.

## H0 — контракт (эта ветка)

**Задачи:** `RX-TSK-0800`

- [x] ADR-0019, спека RX-SPC-0021, DOC-0034, H-04 спокойная миграция, реестр, ветка.
- [x] Флаги `workbench.harness.*` в `packages/core/src/platform/workbench/flags.ts` + Appearance toggle (default false). `workbench.terminal.v1` / `execution.coordinator.v1` тоже в реестре, без PTY.
- [x] Влить каталог `docs/specs/2026-08-25-unified-execution-workbench/` с `origin/main` (документы, без кода PTY).

**DoD:** `bun run rx:validate` зелёный; спека читается без DSH-жаргона в пользовательских строках.

## H1 — инспектор сессии (`RX-TSK-0801`)

Инспектор = правый док. Терминал = вкладка MAIN (UEW), не четвёртая иконка дока.

Флаг: `workbench.harness.inspector.v1`

**Зачем:** это та фича, из-за которой DSH «нравится» — VS Code-подобная правая колонка.

**Файлы:**

- Modify: `apps/electron/src/renderer/platform/InspectorHost.tsx`, `platform/core-panels.ts` (`PanelRegistry`)
- Modify: `apps/electron/src/renderer/components/app-shell/AppShell.tsx` — сейчас `isRightSidebarVisible={false}`; колонка инспектора сессии **MUST** работать и при unified-shell OFF
- Modify: `apps/electron/src/shared/types.ts` (`RightSidebarPanel`) + `route-parser.ts` + `NavigationContext.tsx` только если URL остаётся SoT для вкладки инспектора
- Reuse: `SessionFilesSection.tsx` (переезд из popover в инспектор), `FileViewer.tsx`, `WebBrowserPanel.tsx`
- **Не** reuse `SessionGitOutline.tsx` как git: это outline веток чата. Git-вкладка — новый panel (`git status`/`diff` workspace cwd)
- Terminal: **не** член `RightSidebarPanel`. Команда инспектора «Открыть терминал» открывает `SurfaceTab { kind: 'terminal' }` (контракт UEW M3). Если `workbench.terminal.v1` off — команда disabled + tooltip. **MUST NOT** тащить `node-pty` в renderer: G1 = native-crate.
- Скелет `ExecutionCoordinator` не писать заново, если можно перенести из worktree `_worktrees/rox-one-uew-m7-plan` (`packages/server-core/src/execution/`).

Расширение типа инспектора (черновик контракта):

```ts
export type RightSidebarPanel =
  | { type: 'files'; path?: string }
  | { type: 'history' }
  | { type: 'git' }
  | { type: 'browser' }
  | { type: 'context' }
  | { type: 'none' }
```

`context` заводим типом в H1, наполняем в H3.

**Тесты:** round-trip URL `?sidebar=`; toggle не ломает `files`/`history`; i18n keys `inspector.tab.*`; в union нет `'terminal'`.

**DoD:** в сессии переключаются вкладки Files / Git / Browser без регрессии files-watch. Кнопка терминала не создаёт PTY при флаге UEW off.

Реализовано за `workbench.harness.inspector.v1`: InspectorHost в session-режиме, URL `?sidebar=git|browser|context|files`, git через `git:getStatus`, терминал disabled.

## H2 — хром чата (`RX-TSK-0802`)

Флаг: `workbench.harness.chat-chrome.v1`

| Кусок | Файлы | Поведение |
|---|---|---|
| История промптов | `FreeFormInput.tsx`, `input-event-guards.ts`, новый `prompt-history.ts` | Idle + caret в начале/пусто → стек. **Во время хода ArrowUp по-прежнему cancel+recall текущего промпта.** Не перехватывать середину строки |
| Прогресс хода | `ToolbarStatusSlot.tsx`, `ActiveTasksBar.tsx`, `TurnCard` todos | todos уже есть; добавить tok/s / фазу хода |
| Cost $ | `SessionInfoPopover` + `StatusBarHost` / compact input | Сейчас % контекста; показать `tokenUsage.costUsd` |
| Open in editor | `actions/definitions.ts` | `workspace.openInEditor`; cmux/VS Code/Cursor/Zed по PATH; никогда `open -a Terminal` |

Paste и notify — reuse, не в этом PR.

**DoD:** idle ↑↓ ходит по истории; mid-turn ArrowUp всё ещё отменяет ход; длинный черновик не стирается; в popover сессии виден costUsd.

Реализовано за `workbench.harness.chat-chrome.v1`: prompt-history + idle caret-start ↑↓; processing ArrowUp без изменений; tok/s/фаза в ToolbarStatusSlot; `tokenUsage.costUsd` в SessionInfoPopover и StatusBarHost; `workspace.openInEditor` через PATH.

## H3 — интеллект агента (`RX-TSK-0803`)

Флаг: `workbench.harness.agent-intel.v1`

| Кусок | Файлы | Поведение |
|---|---|---|
| Context dashboard | inspector `context` | доли: system / skills / mcp / transcript / attachments. Read-only |
| MCP lens | `packages/session-tools-core/src/tool-defs-filtering.ts`, `omp-agent.ts` loadMode | скрыть non-essential tools; показать счётчик |
| Fallbacks | status item | «переключено на X» только если runtime это сделал; иначе `live не проверено` |
| Permission auto-review | `PermissionRequest.tsx` | опциональный shadow reviewer; UI остаётся источником allow/deny |
| Permission rules | `permissions-config.ts` | расширить JSON rules, **без** network proxy 127.0.0.1 как в DSH |

**DoD:** дашборд совпадает с фактическим prompt assembly (тест на фикстуре транскрипта). Auto-review не может сам нажать Allow.

Реализовано за `workbench.harness.agent-intel.v1` (нужен inspector): read-only context shares; MCP lens; fallback «live не проверено», пока runtime не записал switch; shadow review без авто-Allow.

## H4 — Extension Center (`RX-TSK-0804`)

Флаг: `workbench.harness.ext-center.v1`

Довести S-05 UI: один экран Skills + Sources + Automations + Marketplace. Адаптеры уже есть в `packages/shared/src/extensions/adapters/`. Живая страница — `ExtensionsSettingsPage.tsx`; файла `platform/ExtensionCenter.tsx` из спеки S-05 **нет** — H4 либо создаёт host, либо честно доводит settings page, без второго каталога.

**MUST NOT** добавить runtime `dsh-cordis`.

**DoD:** enable/disable skill и MCP source с одного экрана; физические сторы не мигрируют.

Реализовано за `workbench.harness.ext-center.v1` на существующей `ExtensionsSettingsPage` (без `platform/ExtensionCenter.tsx`). Четыре группы на одном экране; `extensions:setEnabled` пишет только `extensions/state.json`.

## H5 — импорт, advisor, simplify, workflow (`RX-TSK-0805`)

Без нового флага оболочки; фичи как команды/скиллы. Импорт — отдельный контур (H-04 §4), не «ещё одна кнопка в settings».

### H5a — импорт (P0)

**Файлы:** `packages/shared/src/sessions/import-{discover,convert,persist,registry}.ts` + settings page + команда `sessions.import`.

Пайплайн first-party (не Cordis, не HTTP `:43120`):

1. `discover` — индекс чужих корней (P0: `~/.grok/sessions`, `~/.claude/projects`, `~/.codex/sessions`, opencode db, hermes db). Кэш в workspace Rox.
2. `convert` — чистые парсеры. Grok = `summary.json` + `chat_history.jsonl`.
3. `persist` — новая Rox-сессия (craft transcript). **MUST NOT** писать `session.jsonl.zstd` / `~/.dsh`.
4. `attach` — текущий workspace. cwd `$HOME` не создавать как workspace.
5. `refresh` — явная перезагрузка списка сессий.

Идемпотентность: тот же `sourcePath` → skip / append / force. Пустые источники (0 user turns) → skip с причиной.

**DoD:** один Claude JSONL **и** один Grok-каталог → две Rox-сессии в текущем workspace; `rg '~/.dsh' ` по коду импорта пуст.

### H5b — advisor / simplify / workflow / btw

- Advisor: включить bundled reviewer skill; не второй hidden session без ведома.
- Simplify: skill над git diff (superpowers/simplify-code уже рядом).
- Workflow: существующий `SessionWorkflowEditor` + `tasks:*`.
- BTW: follow-up island, reuse annotations.
- GenUI: не портировать; rich blocks уже покрывают mermaid/html/pdf.

P1/P2 форматы импорта — follow-up PR после зелёного H5a, те же интерфейсы.

**DoD волны:** DoD H5a + advisor/simplify не создают второй агентный loop.

Реализовано first-party: `import-{discover,convert,persist,registry}.ts`, команда `sessions.import` → Settings → Import, persist пишет `sessions/<id>/session.jsonl`. Advisor/simplify — bundled skills в текущем чате (`@advisor` / `@simplify`), без `spawn_session`. Workflow открывает существующий `SessionWorkflowEditor` (map). P1/P2 форматы — follow-up.

## H6 — closeout (`RX-TSK-0806`)

Skip-list заморожен в этом файле и в Appearance → «не устанавливаем». В плане нет отложенного session-buddy. Прогнать `bun run rx:validate`, i18n parity, typecheck затронутых пакетов.

**Freeze (не устанавливаем):** session-buddy, mnemon, plugin hot-reload, agent-teams runtime, vision CLI plugin, search CLI plugin, extra automation runtime, remote-control compat. Канон: `HARNESS_SKIP_LIST`. Appearance показывает тот же список без тумблеров. Отложенного session-buddy в плане нет.

Реализовано: Appearance → Workbench → «не устанавливаем»; анти-цели H-03 §9.

## Порядок веток и merge

```text
origin/main (UEW M0–M3 docs)
        \
         \  merge into rox/session-harness-port before H1 terminal tab
          \
rox/ru-codex-navigation ──► rox/session-harness-port (эта ветка)
                                 │
                                 ├─ PR docs H0
                                 ├─ PR H1
                                 ├─ PR H2
                                 └─ …
```

Не форсить в `main`. Не смешивать H1 и H3 в одном PR.
