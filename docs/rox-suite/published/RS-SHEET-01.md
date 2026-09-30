# RS-SHEET-01 — Rox Sheets: сохраняемая таблица с формулами, совместным редактированием и связями с сущностями

## Запрос и ожидаемый результат

Drive/Docs → «Создать» → «Rox Sheets»; Project → Documents; универсальная ссылка открывает тот же документ.

Основание: пользовательские screenshots #5. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Notes уже имеет table/base projections над заметками и фиксированные счётчики формул. Это не полноценная workbook spreadsheet; её не следует выдавать за существующий Rox Sheets.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [apps/electron/src/renderer/pages/notes/note-views.ts#L5-L37](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/notes/note-views.ts#L5-L37) — NoteBaseView / NOTE_FORMULA_EXPRS.
- [apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L60-L106](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L60-L106) — NotesViewHost.
- [packages/core/src/rox2/platform-contract.ts#L16-L139](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L16-L139) — ROX2_ENTITY_KINDS / Rox2Entity.
- [apps/electron/src/renderer/components/pages/PagesHome.tsx#L24-L109](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/pages/PagesHome.tsx#L24-L109) — PagesHome.

## Экран и UI

- Верх: breadcrumb, title, saved/sync status, presence, Share, menu. Под ним compact toolbar: undo/redo, формат, число/дата/валюта, align, filter, insert; formula bar с адресом клетки.
- Grid: row/column headers, sticky first row; selected cell имеет тонкий контур, range мягкую заливку; bottom sheet tabs «Лист 1» + добавить. Inspector справа по требованию: comments/links/history.
- Минимальный первый vertical slice: 2 листа, typed cells, CSV import/export, SUM/AVERAGE/IF и прямые ссылки; поддерживаемые формулы перечислены, неподдерживаемые дают явный результат.

## Inputs

- Workbook name 1–200 символов; cells null|string|boolean|decimal-string|date; locale/timezone отдельно от хранения.
- Cell input/formula string до лимита; expression parser без eval/JS/network. Range/paste TSV до согласованного лимита, лимит и truncation показаны до apply.
- EntityRef в link cell; комментарии с mention; expectedRevision/operationId на структурные изменения.

## Outputs

- Workbook/Sheet/Cell IDs стабильны после reload; raw input и вычисленный value/error хранятся раздельно.
- Formula dependency graph recalculates; циклы → #CYCLE, неверная ссылка → #REF, тип → #VALUE с понятным tooltip.
- CSV download с корректным escaping; warning о formula injection при открытии внешним spreadsheet; file artifact с checksum.

## Hover / focus / click / keyboard / UX

- Hover cell не создаёт курсор соседа; tooltip ошибки/формулы по hover и focus, full help через click.
- Enter завершает edit и смещает на строку; Tab — колонку; Esc отменяет текущую клетку; стрелки навигация, F2 редактирование; IME не ломает ввод.
- Режим просмотра блокирует edit, но позволяет копировать; presence range/cursor эпhemeral. Undo только собственные локальные edits; структурные CAS conflicts требуют reconcile.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

Canonical kind=page, contentKind=sheet и workbook payload; Document — имя интерфейса содержимого, не новый entity kind. PageKind/CSP остаётся отдельным runtime свойством. Существующие IDs/slug/aliases/grants сохраняются; общие EntityRef, Attachment, Link, ACL, search/activity/agent gateway. Не превращать каждую клетку в workspace Entity и не копировать CRM компании в независимую table.

## Commands / API / DB / events

PROPOSED: spreadsheet.createWorkbook, spreadsheet.applyCellOps (single-cell adapter к spreadsheet.editCell), spreadsheet.patchStructure, spreadsheet.export; gateway authentication/ACL/operationId. CRDT для cell edits по stable rowId/columnId/cellId; A1 — display address, не identity. CAS structureVersion для insert/delete/reorder. Offline ops несут базовую structureVersion: surviving IDs rebase, deleted row/column tombstones отклоняют edit без resurrection; конфликт сохраняет разрешённый draft для явного переноса в новую клетку. Formula refs связываются со stable IDs, адреса пересчитываются. CAS для sheet structure. Postgres metadata + CRDT snapshot/WAL + object storage attachments; outbox sheet.changed/export.ready. Search индексирует title/textual cells с tenant/ACL фильтрами.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `apps/electron/src/renderer/pages/notes/note-views.ts`, `apps/electron/src/renderer/pages/notes/NotesViewHost.tsx`, `packages/core/src/rox2/platform-contract.ts`, `apps/electron/src/renderer/components/pages/PagesHome.tsx`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `packages/shared/src/documents/sheets/contracts.ts`
- `apps/workspace-service/src/modules/documents/sheets.ts`
- `apps/electron/src/renderer/components/documents/sheets/SheetsEditor.tsx`
- `tests/rox-suite/sheets/workbook.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Два пользователя меняют разные клетки, формула пересчитывается одинаково; reconnect сохраняет pending ops; revoked пользователь прекращает write/read.
- [ ] Импорт CSV → edit formula → reload → export без потери types/escaping; cycle не зависает UI. A offline edits cell, B deletes its row: reconnect не воскресит row; rebase соседней surviving cell корректен.
- [ ] Sheet mention в Task и agent readRange возвращают тот же entity/ref/revision; viewer agent не может write.

## Definition of Done

- [ ] UI/routing/input/output/help/keyboard/state contracts реализованы; loading/empty/error/denied/retry доступны и проверены.
- [ ] Persistence и reload; meaningful negative case; concurrency/reconnect где применимо; N/A обоснован в receipt.
- [ ] Общие grants, links, search, mentions, activity, notification и agent policy интегрированы для новой domain entity.
- [ ] Targeted tests + seeded broken control действительно отклоняется; regression existing route/authority пройдена.
- [ ] Linux domain/renderer evidence; реальные Electron screenshots/ARIA/theme/font после UI changes; provider lane только для реальных external effects.
- [ ] Source commit, exact diff, logs/hashes, expected/observed, миграция/rollback и независимое review приложены. Нельзя принимать экран без механизма.

## Cloud handoff

Статус: PLANNED_NOT_IMPLEMENTED / PREPARED_NOT_LAUNCHED. Работать в отдельном branch/worktree от exact inputSha, один writer на файл. Reference: cloud/macro-integration/EXECUTOR-CONTRACT.md; сначала согласовать новый RS scope/packet с scheduler, существующий 52-WP manifest не автоматически включает эту задачу. Proofs домена, browser, native и provider — отдельные lanes, только actual PASS.

## Dependencies / связанные issues

<!-- ROX-SUITE-LINKS -->
Dependencies: RS-DRV-01, RS-DOC-01
- Related existing issue: https://github.com/rox-one/rox-one/issues/563
- Related existing issue: https://github.com/rox-one/rox-one/issues/564
- Related existing issue: https://github.com/rox-one/rox-one/issues/570

## Complexity / риски

XL, разбить на проверяемые подэтапы в issue. Формульный engine dependency/license, large grid virtualization, CRDT structure. Полный Excel/XLSX/Pivot parity не заявляется до отдельных slices.


## GitHub dependency links (нормативный handoff)

- Требуется [RS-DRV-01 — #1109](https://github.com/rox-one/rox-one/issues/1109)
- Требуется [RS-DOC-01 — #1110](https://github.com/rox-one/rox-one/issues/1110)
- Связанный ранее созданный issue: [#563](https://github.com/rox-one/rox-one/issues/563)
- Связанный ранее созданный issue: [#564](https://github.com/rox-one/rox-one/issues/564)
- Связанный ранее созданный issue: [#570](https://github.com/rox-one/rox-one/issues/570)

Specification ID: RS-SHEET-01. Снимок исходного ROX: 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Эти ссылки задают зависимости, а не статус выполненной реализации.
