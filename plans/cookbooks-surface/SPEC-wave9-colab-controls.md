# SPEC wave 9 — «Colab Controls & Navigation» (кукбуки)

База: origin/main `1dc82c78e` (2026-10-14). Ветка волны: `feat/cookbooks-wave9` (воркдерева `~/Projects/rox-worktrees/cookbooks-wave9`).
Точка отката: main до слияния PR волны. Негоциируемые линии: точки отката волн 6–8 сохраняются.

**Статус:** ✅ DONE — влито в main: PR #2027 @ `475034b4` (2026-10-14); фиксы ревью `4c0959082`.

## Цель

Довести поверхность кукбуков до Colab-паритета по **управлению** и **навигации**: остановка выполнения, оглавление, запуск выше/ниже, прогресс-строки (`\r`), копирование исходника, экспорт `.ipynb`, автоскролл к бегущей ячейке. Плюс два сателлита: фикс G4-CBK-01 (редакция до записи в temp) и dev-гигиена (изолированный dev-запуск).

## Non-goals (осознанно вне волны)

- Структурные операции над ячейками (add/delete/move/duplicate) — требуют мутаций документа в сайдкаре; отдельная волна.
- Стриминг вывода (SSE/WS) — архитектурное расширение; отдельная волна.
- Очередь/параллельные запуски, богатый вывод (изображения/HTML), stdin/`input()` — вне скоупа.

## Контракты

### 1. Сайдкар: отмена

- `POST /cancel {itemId: string}` → `200 {ok: true, cancelled: <int>}` — прерывает все активные выполнения itemId (и `/run`, и `/run-all`); идемпотентно; `cancelled:0` при отсутствии активных; нерезолвящийся itemId → как у прочих маршрутов (404).
- `/run` и `/run-all` ответы получают `"cancelled": true|false` (аддитивно, старые поля не меняются).
- Механика: потокобезопасный реестр активных Kernel по itemId в kernel.py (host — ThreadingHTTPServer, конкурентные потоки + Lock); прерывание — существующий kill process group (`_kill_process_tree`). Реализация реестра — на усмотрение исполнителя, контракт поведения — жёсткий.
- `LabHost.stop()` дополнительно убивает активные выполнения → после остановки сайдкара нет живых процессов ячеек (фикс утечки `start_new_session=True`).

### 2. G4-CBK-01: редакция до записи

Драйвер run-all получает значения секретов в job-JSON и применяет `redact_output` ДО записи каждого record в temp `results.json`. Caller-side редакция остаётся (defense in depth). Acceptance: lab-тест — значение секрета, напечатанное ячейкой, отсутствует в `results.json` и в ответе.

### 3. IPC-каналы (additive)

- `cookbooks-lab:cancel` invoke `{itemId}` → `{ok: boolean, cancelled: number}` — LOCAL_ONLY.
- `cookbooks-lab:export` invoke `{itemId, filename, content}` → `{saved: boolean, path?: string}` — main: `dialog.showSaveDialog({defaultPath, filters:[ipynb]})`; отмена → `{saved:false}`; иначе `fs.writeFile(path, content)` → `{saved:true, path}`; ошибка → throw (renderer → notice).
- DTO: `CookbooksRunResult.cancelled?: boolean` (проброс с сайдкара). Ячейки run-all без результата при `cancelled:true` рендер помечает локально как `'cancelled'`.
- Обновляются: `packages/shared/src/protocol/{channels,routing}.ts`, `apps/electron/src/shared/{types,cookbooks,transport/channel-map}.ts`, `apps/electron/src/main/{handlers/cookbooks,cookbooks-runtime}.ts`, generated-список `apps/electron/src/shared/__tests__/ipc-channels.generated.ts`.

### 4. Построитель экспорта (shared, pure)

`apps/electron/src/shared/cookbooks.ts`:
`buildNotebookExport(input: {title: string; cells: Array<{cellType: 'code'|'markdown'; source: string; executionCount?: number|null; stdout?: string; error?: string}>}): string`
nbformat 4 / minor 5; `metadata.title`; source/stdout/error → построчный split (каждая строка с `\n`, кроме последней); code: `execution_count ?? null`, outputs: stdout → `{output_type:'stream',name:'stdout',text}` , error → `{output_type:'stream',name:'stderr',text}`; markdown: `{cell_type:'markdown',metadata:{},source}`. Детерминированный; возвращает pretty-JSON. Тесты: `apps/electron/src/shared/__tests__/cookbooks-export.test.ts`.

### 5. Рендер (поверхность)

Testid-контракт (зафиксирован):

| Элемент | testid | Примечание |
|---|---|---|
| Стоп (ячейка) | `cookbooks-stop-${index}` | видна, пока busy на этой ячейке |
| Стоп (run-all) | `cookbooks-stop-all` | в шапке при busy=run-all |
| Оглавление | `cookbooks-outline` | `<details>`; скрыто при 0 заголовков |
| Пункт оглавления | `cookbooks-outline-item-${n}` | клик → scrollToCell |
| Запуск выше/ниже | `cookbooks-run-above-${index}` / `cookbooks-run-below-${index}` | code-ячейки; disabled при пустом подмножестве/busy |
| Копировать исходник | `cookbooks-copy-source-${index}` | |
| Экспорт | `cookbooks-export` | только ipynb+supported |

- Esc во время busy = отмена (`handleDocumentKeyDown`).
- Автоскролл одиночного запуска: `scrollToCell(index)`.
- `normalizeOutputText` (эмуляция каретки: `\r\n`→`\n`; в строке оставить фрагмент после последнего `\r`) применяется к выводу.
- Утилита — `apps/electron/src/renderer/pages/cookbooks/output-text.ts` (или в файле страницы) + юнит-тесты.

### 6. i18n (16 ключей; en-источник; ru — контрольные)

| Ключ | en | ru |
|---|---|---|
| cookbooks.actions.stop | Stop | Остановить |
| cookbooks.actions.copySource | Copy source | Копировать исходник |
| cookbooks.actions.runAbove | Run above | Выполнить выше |
| cookbooks.actions.runBelow | Run below | Выполнить ниже |
| cookbooks.actions.export | Download .ipynb | Скачать .ipynb |
| cookbooks.cell.stopLabel | Stop cell {{index}} | Остановить ячейку {{index}} |
| cookbooks.cell.cancelled | stopped | остановлено |
| cookbooks.status.cellCancelled | Cell {{index}}: stopped · {{duration}} | Ячейка {{index}}: остановлено · {{duration}} |
| cookbooks.notice.runCancelled | Execution stopped | Выполнение остановлено |
| cookbooks.notice.sourceCopied | Source copied | Исходник скопирован |
| cookbooks.outline.title | Contents | Содержание |
| cookbooks.outline.itemLabel | Go to {{title}} | Перейти к {{title}} |
| cookbooks.export.saved | Saved to {{path}} | Файл сохранён: {{path}} |
| cookbooks.export.cancelled | Save cancelled | Сохранение отменено |
| cookbooks.export.failed | Could not save the file | Не удалось сохранить файл |
| cookbooks.help.shortcutStop | Esc — stop execution | Esc — остановить выполнение |

### 7. Dev-гигиена

`scripts/dev-isolated.ts` + script `electron:dev:isolated` + `.gitignore` (`.dev-isolated/`) + абзац в `apps/electron/README.md`. Env: `ROX_CONFIG_DIR=CRAFT_CONFIG_DIR=<repo>/.dev-isolated/config`, `CRAFT_USER_DATA_DIR=…/userdata`, `TMPDIR=…/tmp`. `--print` печатает план без запуска.

## Вендоринг

Источник: `/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks` (без VCS). Синк — rsync/cp по PROVENANCE.md; после — регенерация sha256-манифеста в PROVENANCE.md (дата снапшота обновляется) + `ELECTRON-CONTRACT.md` (via `docs/electron-integration.md` лабы). Проверка: `python3 scripts/electron_handshake_probe.py` → `[SUMMARY] 0 failed`.

## Гейты волны

1. Lab: свои тесты (cancel, редакция) зелёные; probe 0 failed.
2. TS: focused-тесты (page, shared-export, main) зелёные; `bun run typecheck:all` — оркестратор после слияния слайсов.
3. i18n: `bun run lint:i18n:parity` + `:sorted` + `:budget`; `sort-locales` применён.
4. `bun run lint:ui-tokens` (ratchet) — без новых нарушений.
5. Smoke: изолированный dev-запуск — по возможности; иначе интеграционные тесты с реальным сайдкаром (прецедент wave 8).
6. Ревью: reviewer (G3) + security-reviewer (G4); merge в main (required: freshness, ESLint ratchet, UI-token, unified-gates).

## Слайсы и владельцы (параллельный диспатч)

| Слайс | Владелец | Зона |
|---|---|---|
| P | python-исполнитель | лаб-репо → cancel + stop-kill + CBK-01 + lab-тесты + ре-вендор + probe |
| M | main-исполнитель | каналы/runtime/handlers/types + buildNotebookExport + тесты |
| U | renderer-исполнитель | страница + тесты (стоп, оглавление, выше/ниже, \r, копия, экспорт, автоскролл) |
| I | i18n-исполнитель | 12 локалей (16 ключей) |
| D | dev-исполнитель | scripts/dev-isolated.ts + доки + .gitignore |
