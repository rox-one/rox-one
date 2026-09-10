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

- [x] ADR-0019, спека RX-SPC-0021, DOC-0034, реестр, ветка.
- [ ] Флаги `workbench.harness.*` в `packages/core/src/platform/workbench/flags.ts` + Appearance toggle (можно в том же PR, что H1, если H0 остаётся docs-only).
- [ ] Влить каталог `docs/specs/2026-08-25-unified-execution-workbench/` с `origin/main` (документы, без кода PTY).

**DoD:** `bun run rx:validate` зелёный; спека читается без DSH-жаргона в пользовательских строках.

## H1 — инспектор сессии (`RX-TSK-0801`)

Флаг: `workbench.harness.inspector.v1`

**Зачем:** это та фича, из-за которой DSH «нравится» — VS Code-подобная правая колонка.

**Файлы:**

- Modify: `apps/electron/src/shared/types.ts` (`RightSidebarPanel`)
- Modify: `apps/electron/src/shared/route-parser.ts` (`parseRightSidebarParam` / `buildRightSidebarParam`)
- Modify: `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- Modify: `apps/electron/src/renderer/components/right-sidebar/*`
- Reuse: `SessionFilesSection.tsx`, `FileViewer.tsx`, `WebBrowserPanel.tsx`, `SessionGitOutline.tsx`
- Terminal tab: если UEW `workbench.terminal.v1` off — вкладка показывает empty + «терминал включится с UEW»; **MUST NOT** тащить `node-pty` в renderer в этом PR.

Расширение типа (черновик контракта):

```ts
export type RightSidebarPanel =
  | { type: 'files'; path?: string }
  | { type: 'history' }
  | { type: 'git' }
  | { type: 'terminal' }
  | { type: 'browser' }
  | { type: 'context' }
  | { type: 'none' }
```

`context` можно завести типом в H1 и наполнить в H3.

**Тесты:** round-trip URL `?sidebar=`; toggle не ломает `files`/`history`; i18n keys `inspector.tab.*`.

**DoD:** в сессии переключаются вкладки Files / Git / Browser без регрессии текущего files-watch. Terminal не падает при флаге UEW off.

## H2 — хром чата (`RX-TSK-0802`)

Флаг: `workbench.harness.chat-chrome.v1`

| Кусок | Файлы | Поведение |
|---|---|---|
| История промптов | `FreeFormInput.tsx`, новый `prompt-history.ts` рядом с `working-directory-history.ts` | ArrowUp/Down только когда caret в начале/пустой строке; не перехватывать редактирование середины |
| Прогресс хода | `ToolbarStatusSlot.tsx`, `ActiveTasksBar.tsx` | todos + interrupt + tok/s из существующих agent events |
| Cost | status bar + `SessionInfoPopover` | session / today; цифры только из `tokenUsage` |
| Notify on turn | `notifications.ts` + session event sink | уже есть API; довязать turn-complete |
| Open in editor | `actions/definitions.ts` | `workspace.openInEditor`; cmux/VS Code/Cursor/Zed по PATH; никогда `open -a Terminal` |
| Paste files | `ChatInputZone` attachments | paste image/file → workspace attachment, как существующий drag-drop |

**DoD:** пустой чат, длинный промпт, стрелки не уничтожают черновик; уведомление на macOS при конце хода с выключенным окном.

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

## H4 — Extension Center (`RX-TSK-0804`)

Флаг: `workbench.harness.ext-center.v1`

Довести S-05 UI: один экран Skills + Sources + Automations + Marketplace. Адаптеры уже есть в `packages/shared/src/extensions/adapters/`.

**MUST NOT** добавить runtime `dsh-cordis`.

**DoD:** enable/disable skill и MCP source с одного экрана; физические сторы не мигрируют.

## H5 — импорт, advisor, simplify, workflow (`RX-TSK-0805`)

Без нового флага оболочки; фичи как команды/скиллы.

- Chat import: `packages/shared/src/sessions/import-*.ts` + settings page.
- Advisor: включить bundled reviewer skill; не второй hidden session без ведома.
- Simplify: skill над git diff (superpowers/simplify-code уже рядом).
- Workflow: существующий `SessionWorkflowEditor` + `tasks:*`.
- BTW: follow-up island, reuse annotations.
- GenUI: не портировать; rich blocks уже покрывают mermaid/html/pdf.

**DoD:** импорт одного Claude Code JSONL в новую Rox-сессию без обращения к `~/.dsh`.

## H6 — closeout (`RX-TSK-0806`)

Зафиксировать skip-list в этом файле и в Appearance → «не устанавливаем». Удалить из плана любые «потом возьмём session-buddy». Прогнать `bun run rx:validate`, i18n parity, typecheck затронутых пакетов.

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
