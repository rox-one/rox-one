# H-01. Карта возможностей: DSH-плагин → вклад Rox

- **Doc ID:** H-01
- **Источник версий:** `~/.dsh/profiles/desktop` на 2026-09-10 (mounted bundles + patch inserts).
- **Легенда:** `reuse` = уже есть, не копировать · `extend` = дотянуть существующее · `port` = новая first-party вкладка/сервис · `skip` = сознательно не берём.

Каждая строка — проверяемый контракт волны. «Порт» значит UX + данные на контрактах Rox, не копипаст Cordis-модуля.

## 1. Интерфейс

| DSH-пакет | Ver | Возможность | Вердикт | Куда в Rox | Волна |
|---|---|---|---|---|---|
| `dsh-better-sidebar` | 0.17.1 | Правая панель: files / editor / terminal / git / browser на сессию | **extend** | Расширить `RightSidebarPanel` + Inspector tabs; editor = существующие overlays/`FileViewer`; terminal = UEW `kind:'terminal'`; browser = существующий `BrowserPane` | H1 |
| `dsh-web-plugin-manager` | 0.6.0 | Список / вкл / выкл расширений | **extend** | Extension Center `packages/shared/src/extensions` + settings | H4 |
| `@dsh-community/dsh-paste-input` | 0.1.25 | Ctrl+V / drag-drop файлов в чат | **extend** | `ChatInputZone` / attachments уже есть; добить paste-into-workspace + first-run notice | H2 |
| `@dsh-external/dsh-input-history` | 0.1.13 | Ctrl+↑/↓ по отправленным сообщениям | **port** | `FreeFormInput.tsx` + `actions/` (история cwd уже есть, истории промптов — нет) | H2 |
| `@dsh-external/dsh-ui-progress` | 0.9.17 | Полоса прогресса todos / interrupt / tok/s | **extend** | `ToolbarStatusSlot` + `ActiveTasksBar` + todo events сессии | H2 |
| `dsh-open-in-vscode` | 0.1.6 | Открыть cwd в редакторе | **port** | Команда `workspace.openInEditor`; детект VS Code / Cursor / Zed / cmux. Не хардкодить только VS Code | H2 |
| `@changfenhuang/dsh-genui` | 0.9.9 | Интерактивные блоки в ответе | **extend** | Rich blocks / mermaid / html overlay в `packages/ui`; не тащить GenUI runtime | H5 |
| `@changfenhuang/dsh-annotation` | 1.4.9 | Выделить текст ответа и пометить | **reuse** | `packages/ui/src/components/annotations/` | — |
| `@michengai/dsh-btw` | 0.1.4 | Одноразовый боковой вопрос | **extend** | Annotation island follow-up + `spawn_session` fork. Не новый тип агента | H5 |
| `dsh-md-notes` | 0.12.0 | Markdown-заметки внутри harness | **reuse** | Notes + RX-DOC-0029 / RX-TSK-0411 | — |
| `dsh-notification` | 0.1.1 | OS-notify по концу хода | **extend** | `apps/electron/src/main/notifications.ts` — привязать к turn-complete сессии, не только tasks | H2 |
| `dsh-cost-meter` | 1.7.17 | Стоимость сессии / дня / каталог цен | **extend** | `tokenUsage.costUsd` уже есть; status bar + settings ledger. Каталог цен — server-authoritative, не хардкод 90 моделей в renderer | H2 |
| `dsh-chat-import` | 0.11.0 | Импорт Claude/Codex/ChatGPT/Cursor | **port** | Settings → Import; парсеры в `packages/shared/src/sessions/`; без записи в `~/.dsh` | H5 |
| `dsh-skill-mcp-panel` | 2.0.3 | Скиллы + MCP в одном settings UI | **extend** | Склеить `SkillsListPanel` + `SourcesListPanel` во вкладке Extension Center, не третий список | H4 |

## 2. Мозг агента

| DSH-пакет | Ver | Возможность | Вердикт | Куда в Rox | Волна |
|---|---|---|---|---|---|
| `dsh-context` | 0.47.0 | Дашборд «что съело окно» | **port** | Inspector tab `context`; данные из session transcript + compaction, не отдельный Cordis store | H3 |
| `@michengai/dsh-skills-manager` | 0.1.45 | Ставить/грузить скиллы | **reuse** | `packages/shared/src/skills/` + OMP discovery | — |
| `superpowers-dsh` | 0.1.1 | TDD / debug / plan skills | **reuse** | `apps/electron/resources/skills/superpowers/` уже бандлится | — |
| `dsh-advisor` | 0.3.1 | Второй проход-ревьюер | **extend** | Subagent `reviewer` в `settings.yaml` fallbacks + опциональный skill-pack. Не второй LLM-loop в UI | H5 |
| `dsh-auto-review` | 0.12.1 | Вторая модель на permission prompt | **port** | `PermissionRequest` structured input: optional shadow-review before allow. Fail-closed, timeout deny | H3 |
| `@michengai/dsh-simplify` | 0.1.2 | Упростить git-дифф | **extend** | Skill + команда над `ShikiDiffViewer` / multi-diff overlay | H5 |
| `dsh-llm-fallbacks` | 0.4.2 | Запасная модель при отказе | **extend** | Combo / OMP `retry.modelFallback` — UI честный статус в status bar (brandbook FR-11: не выдумывать combo id) | H3 |
| `dsh-mcp-lens` | 0.1.0-rc.9 | Режет MCP-контекст | **port** | `mcpPool` loadMode + tool-defs filtering (`session-tools-core`). Inspector показывает «скрыто N tools» | H3 |
| `dsh-permission-rules` | 0.6.16 | Декларативные правила + сетевой прокси | **extend** | `permissions-config.ts` + RX-DOC-0031 fail-closed. **Не** копировать whitelist-прокси DSH (он ломал github.com на Desktop) | H3 |
| `@dsh-external/workflow` | 0.1.2 | Dynamic workflows | **extend** | `WorkflowSpec` / `tasks:*` + `SessionWorkflowEditor`. Не KodaX-harness внутри Cordis | H5 |
| `@liustack/modlens` | 3.26.1 | Vision через Antigravity CLI | **skip→source** | Уже есть vision-модели Rox и `browser_tool`. Отдельный CLI-плагин не тащить. При необходимости — MCP source | H6 |
| `@liustack/modsearch` | 5.10.2 | Веб/X поиск | **skip→source** | MCP/API source (Exa/Tavily/Firecrawl уже в операторском контуре). Не вшивать ключи | H6 |
| `dsh-hot-reload` | 0.2.4 | Live reload плагинов | **skip** | В Desktop всё равно требовал рестарт; у Rox hot path — флаги и RPC refresh, не Cordis HMR | H6 |

## 3. Выключено в DSH и здесь тоже skip

Эти пакеты лежали на диске Desktop, но были сняты с запуска. В Rox **MUST NOT** появляться как runtime:

| DSH-пакет | Почему skip |
|---|---|
| `dsh-session-buddy` | Ломал клиент (`missed the module table`). Notify = H2 notifications |
| `@hytime/dsh-client-ui-shortcuts` | Конфликт клиентских модулей. Хоткеи = `actions/` + `KeyboardShortcuts.tsx` |
| `dsh-mnemon` | Требовал `webServer`. Память Rox = `packages/server-core/src/memory/` + self-learning specs |
| `@michengai/dsh-automation` | Тот же `webServer`. Автоматизации уже first-party |
| `dsh-sandbox-escalation-fix` | Патч чужого sandbox. У Rox — `craft-exec` / host-bash jail / UEW ExecutionPolicy |
| `@nanmicoder/dsh-agent-teams` | Несовместимый host. Fan-out = `SessionFanOutSheet` + `spawn_session` |

## 4. Сводка счёта

| Вердикт | Кол-во | Смысл для плана |
|---|---|---|
| reuse | 4 | Не трогаем, кроме документации «уже есть» |
| extend | 14 | Дописываем существующие файлы |
| port | 6 | Новые вкладки/команды/парсеры, first-party |
| skip / skip→source | 11 | Явный отказ или MCP source без кода плагина |

Итого новых поверхностей, которые пользователь *увидит*: inspector tabs (H1), chat chrome (H2), context/cost/review (H3), единый Extension Center (H4), import + advisor (H5). Не 29 плагинов в marketplace.
