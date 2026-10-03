# Единые таблицы — implementation plan v2

2026-09-30. Epic #1295, draft PR #1314. Статус: план опубликован; описанные ниже product slices ещё не приняты. Source baseline `f63294ba4fffa7238b46b24e918925a313ad0b12`; код первого reference codec — `a428eb42c5681adb15d97dcacc88ce45cef7e7a4`. Новые документы не являются доказательством реализованных endpoint/UI/provider операций.

Нормативные документы: [PRD-V2](PRD-V2.md), [TECH-SPEC-V2](TECH-SPEC-V2.md), [VERIFICATION-GATES-V2](VERIFICATION-GATES-V2.md). Старый план и исходные issues сохраняют требования; V2 расширяет охват и уточняет точки изменения. Последовательность волн не сокращает конечные S01–S23.

## 1. Режим работы с репозиторием

Перед каждым implementation PR получить свежие main/head, AGENTS.md и package scripts. Зафиксировать source SHA и реально прочитанные symbols; старые LSX ссылки не считать слитыми в main. Не force-push, не менять main и посторонние WIP-ветки. Не запускать подготовленный ранее cloud program по факту публикации этих документов. Один integration owner редактирует общие hot paths: NotesPage, NotesViewHost, MainContentPanel, PageView, SessionTableHost и shared command/automation registries.

Параллельная работа допустима над независимыми новыми modules/tests после согласования shared types. Один PR — один вертикальный срез с работающим readback, не десятки декоративных controls. Роль owner ниже — предлагаемая ответственность, не GitHub assignment и не запущенный агент.

Рабочий цикл: failing semantic test → минимальная реализация → typed boundary/server validation → native owner integration → отрицательный контроль → restart/two-client readback → UI/perf evidence → review. Отсутствующий provider даёт BLOCKED конкретного gate, не mock PASS. Поддерживаемые тестовые команды берутся из текущего checkout; будущий путь теста ниже не объявляется уже существующим.

## 2. Порядок поставки

| Волна | Issues / роль | Что изменить | Обязательный наблюдаемый результат |
|---|---|---|---|
| W0 | #1295/#1296/#1312; integration | Surface inventory S01–S23, owner/route/capability map, v1 fixtures, baseline benchmarks | G00: активный путь отделён от scaffold/dormant; известны blocked owners и зависимости |
| W1 | #1231/#1235/#1239/#1243/#1249/#1304; domain | Сохраняемая definition/custom records; property catalog; adapters; authorized query/patch; epochs | G01–G03/G07: новая property обнаруживается, native value читается и меняется через своего owner |
| W2 | #1296/#1297/#1298/#1250/#1283; integration/editor | Host v2, create/attach intent, standalone+Notes collection/body+comments+Doc, legacy migration | U1: Note→comment→standalone→Doc, одни refs/values после restart на втором клиенте |
| W3 | #1253/#1256/#1254/#1271/#1272/#1279; compute/grid | Records/Sheet bindings, formula worker, dependency graph, range input, typed edit/fill/undo, UI tokens | G04/G05/G09: корректные вычисления, инкрементальный пересчёт, bounded grid, native readback |
| W4 | #1243/#1297/#1307 + #1200/#1209/#1197; native adapters | Sessions/Tasks/Projects/CRM/Dossier/Mail/Feed/Meetings/Calendar/Files/Agents/people/canvas/Pages | S01–S23 маршрутизируются по владельцам; CRM write отдельно подтверждён receipt, не флагом |
| W5 | #1261/#1276/#1098/#1244/#1299–#1305; automation | Cell rules, Button, GoTo/Response/cancel, почта, AI jobs через existing runtime | G06: committed change→одно действие; restart/retry/cancel, provider receipts, никаких effects от render |
| W6 | #1282/#1284/#1306/#1308–#1311; app/data | Widgets/grouping/sync/import/export/publication, shared resource budgets | G08 и соответствующие G05/G07/G09: сохранение, loss reports, безопасная публикация |
| W7 | #1312; QA/security/integration | Полная capability matrix, native UI, cross-client, regression, performance, review | G10: все обязательные claims доказаны на exact SHA; иначе release blocked |

W1 и W3 могут развиваться параллельно на согласованном контракте, но mock adapter не закрывает native gate. W4 начинается с read integration и не обходит ограничения неподдержанных mutations. Все поверхности остаются в конечном охвате; missingDependency — промежуточное состояние, не автоматическое завершение epic.

## 3. Конкретные engineering slices

### Slice A — registry и источники, #1239/#1243

1. Прочитать существующие owner schema/commands: Notes, SessionMeta, Task, Project; связать с существующими scoped refs. По CRM прочитан `packages/server-core/src/meetings/conation/crm.ts`: company/contact/deal targets различать, blocked mutations сохранить до реального adapter.
2. Добавить proposed `packages/core/src/bases/property-catalog.ts` и `packages/server-core/src/bases/property-catalog-service.ts`. Каталог отдаёт permission-filtered descriptors, не все values. Согласовать с planned field-registry.ts/source-adapters.ts, не создавать две реализации.
3. Добавить tests для одинакового label в двух namespaces, rename, удалённого field, revoked field, unknown agent schema. Выдать schema revision и change event.
4. Реализовать адаптеры порциями: Notes+Sessions → Tasks+Projects → CRM/Dossier → прочие owners. Unsupported write явно missingDependency. В проверке required adapter отсутствует — FAIL/BLOCKED, не пустой PASS.
5. G03: property добавлена в native/agent declared schema → picker обновился без reload → выбранная колонка принимает owner delta → formula/query invalidated. Не добавлять колонку автоматически в существующий view без opt-in.

### Slice B — persistence, query, host attach, #1235/#1249/#1296/#1297

1. Definition/View сохраняются у согласованного Page owner; CustomRecord/SheetCell получают versioned authoritative storage, migration и policy. Не копировать native Task/Session/CRM rows.
2. Proposed `packages/core/src/bases/host-registry.ts`, `packages/server-core/src/bases/create-table.ts`, renderer `pages/bases/TableHost.tsx` расширяют existing TableSurface. v1 golden compatibility; v2 host registry проверяет parent, format и capability, не доверяет client grants.
3. QueryWindow: scoped source+field IDs+cursor+revisions; authoritative server filters/sort/totals. Patch: authenticated actor+target refs+expected revisions+operationId+preview digest. Mixed owners возвращают partial receipts.
4. Create intent фиксирует стабильные IDs: validate/reserve → Base commit → parent CAS attach → readback. Crash на каждой границе, timeout после ACK и двойной click должны вернуть ту же Base. Orphan recovery не удаляет чужую используемую Base.
5. G02: создать/изменить/прочитать из другого клиента и после restart; одновременно изменённый parent не перезаписывается.

### Slice C — Notes, комментарии, Doc, #1297/#1298/#1250/#1283

1. Проверенные existing paths: `apps/electron/src/renderer/pages/NotesPage.tsx`, `pages/notes/NotesViewHost.tsx`, `pages/notes/note-views.ts`, `pages/notes/NotesReadingChrome.tsx`. Проследить actual document-ia comment writes перед выбором migration, не объявлять найденные localStorage helpers активным owner без трассировки.
2. Существующий TiptapMarkdownEditor импортируется NotesPage; найти его actual package path перед правкой. Добавить reference NodeView и отдельные codecs serialization. Не менять редактор на новый iframe.
3. Proposed `pages/bases/CommentTableAttachment.tsx` и `packages/server-core/src/bases/comment-table-binding.ts`: draft attach, publish receipt, parent revision, audience intersection, bounded preview. Thread/message owner сохраняется; edit/action только после явного входа.
4. Мигрировать Notes table configs с backup/private scope; сохранить четыре legacy built-ins. Promotion Markdown: preview/mapping/loss report/CAS/undo. Copy-reference отдельно от duplicate-data; импорт инертный.
5. Confirm structured Doc owner/format отдельно. PageView не подменяет Doc editor. U1 обязателен: три create origins плюс комментарий как настоящий host, native readback и второй клиент.

### Slice D — grid, вычисления и аккуратный UI, #1256/#1279

1. Переиспользовать `SessionTableHost.tsx` selection/rank/virtualization semantics как regression baseline, но вынести owner-neutral kernel. Proposed `pages/bases/BaseTable.tsx`, `GridViewport.tsx`, `CellEditorLayer.tsx`, `table-tokens.css`; existing NotesTableView переводить через adapter, не копией данных.
2. Formula parser/evaluator остаются у #1256: proposed `core/src/bases/formula-parser.ts`, `formula-dependencies.ts`, `server-core/src/bases/formula-evaluator.ts`, renderer worker `pages/bases/formula.worker.ts`. Server и worker используют один versioned pure kernel; no eval/network.
3. Сначала Records typed formulas + legacy; затем Sheet per-cell formula/ranges/absolute-relative refs/named ranges. Для каждой группы — compatibility tests. Нет скрытого writeback derived values в native entities.
4. Dirty graph, range index, batched lookup, pinned evaluation context; discard late results по epoch/revision. Formula sort/filter/chart выполняются сервером по полной authorized selection.
5. Сначала keyboard/IME/stable editor и two-axis virtualization; затем paste/fill/undo с preview/per-cell receipts. Никакого преобразования target refs в текущий visual index после sort.
6. Прозрачные теги/заливки через существующие tokens; sticky на читаемой базовой поверхности; no per-cell backdrop blur. Compact32/comfortable40/touch44; selection/focus/error имеют приоритет над conditional tint. Проверить обе темы, 200% zoom, pointer/keyboard и reduced motion.
7. G04/G05/G09: 10k×30 и 100k×50 logical fixture,1000-cell paste, dirty subset count,20 embeds. Performance budget не подменять count DOM nodes или скриншотом.

### Slice E — остальные hosts и native owners, #1243/#1297/#1307

Подключение идёт через фактические MainContentPanel/NavigationContext/platform routes и owner-specific host adapter. Не ограничиваться scaffold navigation-registry.ts. Для каждого Sxx добавить route smoke, authorized read, supported mutation receipt, denial, lifecycle cleanup. Proposed adapter files располагаются рядом с существующими surface owners либо под `pages/bases/hosts/`; путь утверждается после G00.

S07 Sessions: сохранить status/project/labels/dueDate, filters/rank/focus. S09/S10 Tasks/Projects: native commands и membership. S11/S12 CRM/Dossier: #1200/#1209, настоящий provider/native readback; company detail единая. S13/S14 Mail/Feed: canonical message/thread, preview не grants. S15/S16 Meetings/Calendar: исходные refs, account namespaces/date-only/timezones. S17 Files: импорт explicit, preview inert. S18 Agents/Memory: только declared permitted properties, outputs через typed proposals. S19/S20 Home/Dashboard: разные compositions с общим query/widget, #1197. S21 Canvas/Graph/Outline: bounded reference card, no recursion. S22 public Forms: separate guest capabilities. S23 people/org: identity owner, roles/agents links без профилей-дублей. S06 Pages: сохранить PageView lease/digest и узкий bridge; frame не получает electronAPI.

### Slice F — actions и правила ячеек, #1299–#1305

1. Существующий graph/runtime/command registry — единственный исполнитель. Source commit/outbox triggers добавлять alias mapping, не переименовывать старые event names вслепую.
2. Rule classes раздельны: default/validation/formula/format/onChange/AI. onChange origins + transition + causal budget + logical dedup. Импорт/backfill inert до review. Оптимистический cell edit не trigger.
3. Button rowRef + fieldId + immutable definition + typed prior step output; OpenURL клиентский, последний и не воспроизводится при restart. Повтор transport retry не новая бизнес-операция.
4. While/GoTo bounded checkpoint/backoff; Response привязан caller/schema; cancel fence перед следующим dispatch. Закрытие grid не равно cancel running job.
5. Email trigger требует настоящий gateway; CRM/Task/mail mapping через owners. AI имеет input digest, cost/usage, approval и отдельный CAS apply. Synthetic providers только unit lane; финальная внешняя возможность требует разрешённый test provider receipt.
6. G06/G07: effect-ACK crash, duplicate delivery, revoked principal, recursion, prompt injection, unauthorized dependency, stopped next dispatch.

## 4. Изменения требований по всем UTB issues

| Issue | Обязательная V2 дельта | Gate |
|---|---|---|
| #1296 | Versioned host registry S01–S23, strict v1 compatibility | G00/G01 |
| #1297 | Lifecycle по host capabilities, comment draft/publish, owner readback | G02/G10 |
| #1298 | Comment/Doc serialization, lossless promotion, legacy migration scope | G02/G08 |
| #1299 | Cell rules + causal commits, same actions across permitted hosts | G06/G07 |
| #1300 | Rule recursion/fanout vs pure formula graph, bounded queue | G04/G06 |
| #1301 | Typed result bindings, caller authority, no implicit cell mutation | G06/G07 |
| #1302 | Cell/run states and cancellation fences; unmount != cancel | G06 |
| #1303 | Mail→native entity mapping, explicit formulas/import policy | G06/G08 |
| #1304 | Parent/source intersection, derived/error/cache/AI channels | G07 |
| #1305 | Declared agent properties; materialized AI jobs not volatile formulas | G03/G06/G07 |
| #1306 | Home/Dashboard distinction, Page lease, resource budgets20 embeds | G05/G09 |
| #1307 | Actual routes/recents/property catalog discovery, no scaffold-only success | G00/G03/G10 |
| #1308 | Reuse Session semantics, stable group/focus/derived readonly | G05/G09 |
| #1309 | Schema/value deltas, incremental invalidation, bounded backfill | G03/G08/G09 |
| #1310 | Formula dialect/loss matrix; allowed source scope | G08/G07 |
| #1311 | Guest/comment/frame audience, published actions explicit | G07/G10 |
| #1312 | 23-surface matrix, 11 gates, exact SHA evidence, no skipped-green | G00–G10 |

Связанные #1239/#1243/#1256/#1279 расширяются непосредственно: не создавать конкурирующие каталоги, вычислители или grid epic. Миграции/relations/rollups/ACL остаются у #1250/#1254/#1271/#1272/#1249/#1304, сохранение у #1235.

## 5. Ближайший исполняемый пакет

Первым после review взять **W0 + Slice A/B минимально для Notes и Sessions**, не начинать с десятков кнопок. Acceptance: source property описана один раз → видно её native значение → grid edit вызывает native command → другой host видит receipt/revision → restart сохраняет данные → denied actor ничего не получает. Затем attach внутри реального комментария и только потом расширять sources.

Предлагаемые новые тесты: `tests/unified-tables/property-discovery.test.ts`, `host-registry-v2.test.ts`, `native-owner-readback.test.ts`, `comment-attachment.test.ts`, `formula-incremental.test.ts`, `grid-performance.test.ts` и соответствующие native UI specs. Это **планируемые файлы**, не текущие passing tests. Подключить к существующему Bun/TypeScript/Electron runner после чтения scripts; отсутствующий runner — BLOCKED, не запуск альтернативного isolated suite под видом всего проекта.

Проверки первого codec остаются отдельной исторической lane. Полный native Electron/WebUI/provider verification для V2 NOT_RUN до реального исполнения. Автоматическое закрытие epic по commit/docs count запрещено.
