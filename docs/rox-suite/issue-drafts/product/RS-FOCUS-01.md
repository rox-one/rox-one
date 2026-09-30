# RS-FOCUS-01 — Главная: заменить толстую рамку быстрого ввода задачи на спокойный доступный focus-индикатор

## Запрос и ожидаемый результат

Главная → Трекер задач → «Новая задача — Enter»; тот же паттерн затем применяется к аналогичным compact inputs по явному списку.

Основание: пользовательские screenshots #1. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Исходный input имеет outline-none, но глобальные :focus-visible и contrast/shell правила добавляют собственный outline. Скриншот показывает толстую фиолетовую рамку; точный CSS cascade установленного бинарника ещё надо измерить, SHA бинарника неизвестен.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [apps/electron/src/renderer/platform/home/widgets.tsx#L1125-L1196](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/platform/home/widgets.tsx#L1125-L1196) — TaskTrackerWidget.
- [packages/ui/src/styles/index.css#L327-L351](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/ui/src/styles/index.css#L327-L351) — :focus-visible / contrast / shell focus rules.
- [packages/ui/src/styles/index.css#L476-L481](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/ui/src/styles/index.css#L476-L481) — global *:focus-visible.
- [apps/electron/src/renderer/components/ui/input.tsx#L5-L20](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/ui/input.tsx#L5-L20) — Input.

## Экран и UI

- Высота quick-add 28–32 px, радиус 6 px, иконка Plus 14 px, текст 13 px; размеры карточки/данные виджета сохраняются.
- Обычный focus: слегка усиленный фон всей строки + тонкая нижняя inset-линия 1 px accent; без внешнего фиолетового прямоугольника и без glow. Keyboard focus дополнительно имеет отчётливый leading marker 2×16 px внутри строки.
- Иконка/текст не скачут при focus, hover или появлении кнопки «Добавить». Высокий контраст получает проверенный системный/2 px индикатор; нельзя глобально отключать keyboard focus.

## Inputs

- title:string, trim для submit; пустая строка не отправляется; IME composition Enter не создаёт задачу.
- Pointer focus / Tab focus / Shift+Tab / Enter / кнопка «Добавить»; тема, контраст, shell style, scale 100/150/200%.

## Outputs

- Одна сохранённая personal Task в inbox; очищенный input только после успешного создания; фокус остаётся в строке.
- Ошибка оставляет draft, aria-live сообщает «Не удалось добавить задачу. Повторите попытку»; визуальный focus не маскирует ошибку.

## Hover / focus / click / keyboard / UX

- Hover меняет фон без рамки; help на Plus/focus доступен через кнопку «?» и объясняет Enter.
- Blur возвращает обычный фон, незавершённый title остаётся; выделение текста и caret системные.
- Проверить реальный computed outline/box-shadow/border на Electron, а не только CSS текст.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

Расширить существующий TaskTrackerWidget и input tokens в локальном scope. Использовать createPersonalTask({title,list:"inbox"}); никаких новых task storage/notification engines.

## Commands / API / DB / events

Существующий createPersonalTask; новых API/DB/events не требуется. Нынешний Task store остаётся authority. Дополнительная клавиатурная защита композиции не меняет доменную семантику.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `apps/electron/src/renderer/platform/home/widgets.tsx`, `packages/ui/src/styles/index.css`, `packages/ui/src/styles/index.css`, `apps/electron/src/renderer/components/ui/input.tsx`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `tests/rox-suite/focus/quick-task.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Tab фокус визуально виден без внешней толстой рамки в light/dark/zen; computed outline у обычного quick-input не превышает выбранный inset-паттерн.
- [ ] В high-contrast фокус различим, все элементы достижимы клавиатурой; 200% zoom без clipping.
- [ ] Enter во время IME не отправляет; Enter после composition создаёт ровно одну задачу; ошибка сохраняет draft.

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
Самостоятельный slice; общие registry/policy seams используются из текущего ROX или проверенных prerequisites.
- Related existing issue: https://github.com/rox-one/rox-one/issues/553
- Related existing issue: https://github.com/rox-one/rox-one/issues/578

## Complexity / риски

S. CSS precedence нескольких shells; отсутствие SHA у screenshot binary. Проверять fresh source build + используемый shell, не угадывать root cause.
