# RS-SLIDE-01 — Rox Slides: редактор презентаций, показ, комментарии и экспорт как общая Document entity

## Запрос и ожидаемый результат

Drive → Создать → Rox Slides; Docs template gallery → Presentation; agent создаёт draft с тем же ref.

Основание: пользовательские screenshots #5. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Pages — interactive HTML artifacts; Notes Canvas — карточки с localStorage. В проверенных editor seams нет production presentation domain. Slides — новая payload representation существующего Document, не переименование canvas.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [apps/electron/src/renderer/components/pages/PagesHome.tsx#L24-L109](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/pages/PagesHome.tsx#L24-L109) — PagesHome / handleCreatePage.
- [apps/electron/src/renderer/pages/notes/note-views.ts#L46-L79](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/notes/note-views.ts#L46-L79) — JsonCanvasNode / JsonCanvas.
- [apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L299-L339](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L299-L339) — NotesCanvasView.
- [packages/core/src/rox2/platform-contract.ts#L121-L168](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L121-L168) — Rox2Entity / Rox2Context.

## Экран и UI

- Слева 200–240 px thumbnails с номером и add; центр 16:9 stage с zoom/fit; справа 280–320 px contextual properties. Top toolbar title/save/presence/share/present.
- Добавление text/image/shape/link; layout/theme presets; notes нижняя складываемая панель. Present — fullscreen с next/prev, speaker view и Esc.
- Первые templates: титул, заголовок+текст, 2колонки, изображение, выводы; темы ROX light/dark без обязательного Lark branding.

## Inputs

- Deck title, slides ordered stable IDs; object x/y/w/h normalized to slide coordinate space, zIndex, style tokens.
- Text content/entities; image AttachmentRef с alt; speaker notes; themeId; reorder baseRevision.

## Outputs

- Persisted deck revision; PDF экспорт и thumbnail artifact jobs со status/ошибкой/checksum.
- Share link с общим ACL; связанный Project; searchable visible text/notes только по разрешениям.

## Hover / focus / click / keyboard / UX

- Hover thumbnail показывает duplicate/delete/more; те же действия доступны через keyboard menu.
- Drag/reorder имеет keyboard alternative; arrows move object 1 unit, Shift 10, Delete только выбранный object, Cmd/Ctrl+Z own edit, Esc снимает selection.
- Resize handles 6–8 px с минимумом target area; selection не меняет размеры контента. При revoke stage очищается, cached thumbnails удаляются.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

Canonical kind=page, contentKind=slides; Document — payload interface, не второй ref. PageKind/CSP отдельно; существующие Page IDs/slug/aliases сохраняются. Slide/Object stable child IDs без N×N entity registry. Reuse collaboration identity, grants, links, comments; agent writes through same typed command facade with preview of deck diff.

## Commands / API / DB / events

PROPOSED slides.createDeck/applyContentOps/patchLayout/export. CRDT content + CAS layout/order checkpoints; no concurrent overwrites. Export workers isolated from interactive HTML, no remote scripts, outputs stored as shared File artifact; document.changed/export.ready → common outbox.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `apps/electron/src/renderer/components/pages/PagesHome.tsx`, `apps/electron/src/renderer/pages/notes/note-views.ts`, `apps/electron/src/renderer/pages/notes/NotesViewHost.tsx`, `packages/core/src/rox2/platform-contract.ts`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `packages/shared/src/documents/slides/contracts.ts`
- `apps/workspace-service/src/modules/documents/slides.ts`
- `apps/electron/src/renderer/components/documents/slides/SlidesEditor.tsx`
- `tests/rox-suite/slides/deck.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Создать 3slide deck → text/image/notes → reload → показать → экспорт PDF; каждый слайд имеет стабильный ID.
- [ ] Concurrent text converges, reorder conflict обрабатывается; expired share не раскрывает thumbnail/notes.
- [ ] Agent preview → explicit allowed command → deck diff; read-only agent не меняет layout.

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
- Related existing issue: https://github.com/rox-one/rox-one/issues/570
- Related existing issue: https://github.com/rox-one/rox-one/issues/563

## Complexity / риски

XL. Font embedding/export license, coordinates/collaboration conflict; импорт PPTX и анимации требуют отдельных доказанных scopes.


## GitHub dependency links (нормативный handoff)

- Требуется [RS-DRV-01 — #1109](https://github.com/rox-one/rox-one/issues/1109)
- Требуется [RS-DOC-01 — #1110](https://github.com/rox-one/rox-one/issues/1110)
- Связанный ранее созданный issue: [#570](https://github.com/rox-one/rox-one/issues/570)
- Связанный ранее созданный issue: [#563](https://github.com/rox-one/rox-one/issues/563)

Specification ID: RS-SLIDE-01. Снимок исходного ROX: 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Эти ссылки задают зависимости, а не статус выполненной реализации.
