# Единые таблицы ROX — PRD, ревизия 2

Дата: 2026-09-30. Родитель: #1295. PR: #1314.
Статус: SPEC_PUBLISHED, не реализация функций. Проверенная source baseline: `f63294ba4fffa7238b46b24e918925a313ad0b12`. Первый кодовый срез: `a428eb42c5681adb15d97dcacc88ce45cef7e7a4`.

Ревизия расширяет PRD.md: охват не ограничен standalone/Note/Doc; обязательны комментарии, CRM и остальные поверхности рабочего пространства. Прежние 14 групп Baserow и требования безопасности остаются. При конфликте по охвату, формулам и проверкам применять ревизию 2. Исторический VERIFICATION.md описывает первый codec, не готовность новой ревизии.

Связанные документы: [спецификация](TECH-SPEC-V2.md), [план](IMPLEMENTATION-PLAN-V2.md), [проверочные барьеры](VERIFICATION-GATES-V2.md).

## 1. Продуктовое решение

Не «ещё одна база данных», а общий слой структурированных данных, вычислений, действий и представлений над существующими источниками ROX.

`владельцы сущностей → адаптеры + каталог свойств → разрешённые запросы/команды → вычисления/автоматизации → общий grid → специализированные host-адаптеры`

Общий движок не означает одно хранилище всех данных. Notes, Sessions, Tasks, CRM, Mail сохраняют свои записи, права, ревизии и команды. Base/Table/View хранит определение схемы и запроса. Проекция кешируется, но не становится второй изменяемой копией исходной сущности. Произвольные пользовательские записи имеют собственный canonical CustomRecord owner.

Одинаковая функциональность — одинаковые поддерживаемые операции при одинаковых правах и возможностях источника. Это не обещание записи в read-only CRM, запуска кнопок из публичного письма или наследования чужих полномочий через документ.

## 2. Перепроверенные исходники

Ссылки закреплены на baseline; наличие файла не заменяет запуск интерфейса.

| Источник | Проверенный факт | Следствие |
|---|---|---|
| [NotesViewHost.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx) | Table/Canvas/Graph/Outline, проекция Notes и view config в localStorage | Мигрировать существующую поверхность, не создавать копии Notes |
| [note-views.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/notes/note-views.ts) | NoteBaseView v1; пять операторов; четыре формулы taskCount/openTaskCount/backlinkCount/tagCount | Это ограниченная проекция, не общий вычислитель Excel; сохранить legacy built-ins |
| [NotesPage.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/NotesPage.tsx) | TiptapMarkdownEditor, свойства/frontmatter, комментарии, NoteInspector, Rox2 binding | Подключать существующий редактор и owner |
| [NotesReadingChrome.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx) | NoteComment, comment UI, localStorage helpers и прозрачные color-mix заливки | Проследить активный путь document-ia/NotesPage; не считать комментарии уже единым серверным owner |
| [SessionTableHost.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/components/app-shell/session-table/SessionTableHost.tsx) | Уже есть виртуализация, группировка, selection, metadata и native preferences | Переиспользовать семантику Sessions; не переписывать reorder/selection без регрессионных тестов |
| [PageView.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/components/pages/PageView.tsx) | PageRenderLease, digest, snapshot, PageFrame | Pages не равны Notes/Docs; сохранить sandbox/lease, не передавать frame прямой electronAPI |
| [crm.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/meetings/conation/crm.ts) | accountId+remoteType+remoteId; proposeCrmEdit/sendCrm возвращают blocked | CRM в scope, write readiness BLOCKED до настоящего capability/receipt/readback |
| [MainContentPanel.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx) | Композиция Notes/Tasks/Meetings/Inbox/Feed/Pages/Projects/Sessions, extra screens | Сверять registry с фактическими routes |
| [navigation-registry.ts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/lib/navigation-registry.ts) | Прочитанный реестр содержит scaffold/PlaceholderComponent | Правка только этого файла не подключает все экраны |
| [KnowledgeSurfacePage.tsx](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/KnowledgeSurfacePage.tsx) | SiYuan path выключен, переход ведёт в Notes | Не возвращать старый iframe и не считать dormant код активным |

В этой ревизии native Electron/WebUI, CRM provider и многопользовательское исполнение не запускались. Source audit, unit и product E2E имеют разные статусы.

## 3. Охват: 23 точки интеграции

C — создание; R — ссылка/представление; E — редактирование через owner; A — явное действие; Q — чтение/переход. Это целевые возможности, не подтверждённая готовность. Каждая E/A требует capability и ACL.

| ID | Поверхность | Режим и поведение |
|---|---|---|
| S01 | Отдельная Base/Table | C/R/E/A; полноценная сетка и представления |
| S02 | Коллекция Notes | R/E/A; строки остаются заметками, свойства пишутся Notes owner |
| S03 | Тело Note | C/R/E/A; reference-only Tiptap node, раскрытие полноэкранно |
| S04 | Комментарии Notes/документов | C/R; E/A после parent+source ACL; draft и опубликованный комментарий различаются |
| S05 | Структурированные документы | C/R/E/A; подтвердить host format/owner отдельно, не выдавать PageFrame за Doc editor |
| S06 | Pages/страницы приложений | R/E/A через разрешённый bridge; PageKind и lease сохраняются |
| S07 | Таблица Sessions | R/E/A; status/project/labels/dueDate и новые properties без второго Session store |
| S08 | Чат, сообщения, результаты агента | R/Q; E/A после явного входа; отображение ответа не исполняет действие |
| S09 | Tasks | R/E/A; сроки/состояния/связи через Task owner, прежние checkbox semantics |
| S10 | Projects | C/R/E/A; связанные сущности проекта, rollup, исходное membership |
| S11 | CRM | R/E/A после capabilities; компании/контакты/сделки — разные типы |
| S12 | Dossier/карточки сущностей | R/Q/E/A через owner операции; одна company detail, не второй CRM owner |
| S13 | Inbox/Mail | R/Q, явное создание из письма; получателю не выдаётся доступ к Base |
| S14 | Feed/ветки обсуждений | R/Q/E/A по правам; parent thread сохраняется, render не запускает workflows |
| S15 | Meetings | C/R/E/A для решений/действий, ссылки на встречу/транскрипт |
| S16 | Calendar | R/E/A при поддержке provider; account namespace/date-only/timezone сохранены |
| S17 | Files/attachments/preview | R/Q и явный импорт; просмотр не превращает файл в mutable Base |
| S18 | Agents/Memory | R/Q/A; разрешённые properties, результаты/proposals, не секретная память |
| S19 | ROX Home | R/Q/A; виджеты/недавние/поиск, личный layout отдельно от схемы |
| S20 | Conation Dashboard | R/Q/E/A через свой adapter; не замена Dashboard редактором Home |
| S21 | Canvas/Graph/Outline/MindMap | R/Q; reference card с фокусируемым раскрытием, без рекурсивных вложений |
| S22 | Forms/публичные приложения | R, create-only submit, отдельная публикация действий; guest не publisher |
| S23 | Люди/команды/организация | R/Q/E/A по identity/org owner; роли/расписания/агенты — связи и properties |

S01/S05 и новые editable embeds — планируемые интеграции. S11 имеет проверенный блокирующий seam. S12/S20 дополнительно связаны с #1209/#1197; эти requirements не runtime proof. Код маршрута/каталога для прочих поверхностей подтверждает место подключения, не готовность таблиц. До реализации каждого Sxx нужен G00: exact route, owner, активная feature policy и проверенный read/write seam.

## 4. Требования

**FR-01.** Все команды «Новая управляемая таблица» вызывают один lifecycle Base/Table/View+reference. Старые Markdown-таблицы меняются только явно, с preview/undo.

**FR-02. Каталог свойств.** Новое разрешённое свойство entity/agent/workspace schema появляется в picker после schema event. Оно не добавляет самовольно сотни колонок в сохранённый view: auto-include включается отдельно. Значения выбранных полей подтягиваются автоматически. Одинаковые названия различаются по owner/namespace; rename сохраняет fieldId.

**FR-03. Два режима, один grid.** Records — типизированные записи и формулы колонок. Sheet — индивидуальные формулы ячеек, диапазоны, относительные/абсолютные ссылки. Вычисленная ячейка не получает права писать в CRM/Task без отдельной mapping-команды. Режим виден пользователю.

**FR-04. Формулы.** Автодополнение, типы, инкрементальный пересчёт, межтабличные зависимости, lookup/rollup, понятные ошибки, preview массового заполнения, одинаковый результат grid/chart/export на snapshot. Пересчёт не отправляет письма и не запускает ИИ.

**FR-05. Автоматизация ячеек.** Default/validation/conditional formatting/derived formula отделены от on-change и AI enrichment. Owner event после commit инициирует durable rule execution с causality/dedup/recursion budget. Импорт/backfill по умолчанию не запускают внешние эффекты.

**FR-06. Кнопки.** Одна опубликованная конфигурация и run history во всех разрешённых hosts. Preview/click/keyboard различаются. HTTP→record→email/Slack передаёт typed outputs. Open URL клиентский, безопасный; reload не повторяет навигацию.

**FR-07. Комментарии.** Живая reference с bounded preview, не скрытый снимок всей Base. Создать таблицу из comment draft можно общим lifecycle. Публикация требует durable parent attach. Удаление комментария не удаляет общую Base. Цитирование/пересылка/экспорт не расширяют ACL. Недоступный source не раскрывает title/count.

**FR-08. CRM.** Read/write отдельно; table edit подтверждается CRM receipt и native Dossier readback. Company detail остаётся у Dossier owner. Неподтверждённые Contact/Deal APIs не имитируются локальным успехом.

**FR-09. Ввод.** Диапазоны, clipboard, fill handle, undo/redo, frozen columns/headers, keyboard/IME, validated batch, pending/conflict/error navigation. Paste/fill не обходят ACL/типы. Сортировка не меняет target с entityRef на visual index.

**FR-10. UI.** Существующие токены, компактная оболочка и специализация экранов. Слабые прозрачные заливки/теги, читаемые sticky-поверхности, тонкие разделители. Детали в inspector; основные действия доступны не только hover. Light/dark и 200% zoom обязательны.

## 5. Сквозные сценарии

U1: Base в Note → поле Project/Task → тот же view в комментарии → standalone edit → второй клиент/restart. Совпадают refs/revisions/values; parent ACL не расширен.

U2: property создано через workspace/agent schema → picker обновлён → колонка включена → native edit обновляет grid/formula/chart. Rename сохраняет binding, revoke очищает закрытые projections.

U3: CRM table edit → owner receipt → Dossier readback. Пока adapter blocked, отрицательный тест проходит без поддельной записи; он не заменяет будущий положительный gate.

U4: paste1000 cells → preview invalid/readonly → подтверждение допустимых → per-cell outcomes → undo новыми проверенными командами, без перезаписи чужих параллельных правок.

U5: source cell changed → только затронутые dependencies → правило crossing threshold → одна action chain. Crash/retry не дублируют уведомление. View/export/AI proposal не запускают цепочку.

U6: документ с20 embeds не загружает20 полных datasets; активные viewport-ы делят memory/subscription budget, скрытые приостанавливаются; focus/draft сохраняются.

## 6. Совместимость и Done

«Промышленный Excel» — согласованные grid/formula/workbook-возможности с проверенными бюджетами, не недоказанная полная совместимость XLSX/VBA/PowerQuery. CSV/XLSX, supported formulas, names/ranges, date systems, formatting и unsupported objects — versioned compatibility matrix #1284. Неподдерживаемое не терять молча, не исполнять при импорте.

Сохранены: Button, Graph, Go to, providers/models, homepage, email trigger, Response, cancel/history, dashboard grid, grouping, sync history, field ACL, Airtable import, publication/quotas. Новый scope добавляется к ним. Baserow — референс поведения, не автоматическое право копировать любой код или его коммерческие ограничения.

Done: каждая обязательная поверхность/capability связана с owner, issue, implementation, negative test и native/provider readback. PASS codec не закрывает UI/CRM/formulas/epic. Волны задают порядок, а не сокращение конечного объёма.
