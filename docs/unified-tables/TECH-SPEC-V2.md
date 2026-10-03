# Единые таблицы ROX — техническая спецификация v2

Статус: SPEC_PUBLISHED / IMPLEMENTATION_PENDING. Дата: 2026-09-30. Источники и 23 поверхности S01–S23 перечислены в [PRD-V2](PRD-V2.md). Проверенная source baseline `f63294ba4fffa7238b46b24e918925a313ad0b12`; наличие предложенного API ниже не означает, что такой endpoint уже существует. Дополняет TECH-SPEC.md; прежние требования безопасности и восстановления сохраняются.

## 1. Границы системы и владельцы

```
Native owners: Notes / Sessions / Tasks / CRM / Mail / Projects / ...
                    ↕ typed source adapters, native receipts
Property catalog → Authorized query + command gateway
                    ↕ source/schema/policy revisions
Base definitions / custom records / optional sheet cells
                    ↕ pure calculation engine + durable action runtime
Grid kernel + common field editors + host adapters
                    ↕
S01–S23: standalone, Notes, comments, CRM, Pages, agents, etc.
```

Base definition принадлежит существующему Page/content owner согласно #1231/#1235. Definition содержит bindings, schema, views, formulas и references на опубликованные actions. Native row content остаётся у своего владельца. CustomRecord и SheetCell — отдельные canonical данные только для пользовательских записей/листов, не зеркала Tasks/CRM. Кеш проекций полностью перестраиваем; он не принимает обходные записи.

Общие примитивы: scoped EntityRef, PropertyRef, RowRef, FieldRef, ViewRef, revision, policyEpoch, snapshotId, commandId, eventId. Отображаемое имя не является идентификатором. Для CRM identity включает accountId+remoteType+remoteId. При отсутствии реальной write-capability UI остаётся read-only с причиной; заглушка crm-edit-not-live не заменяется успехом.

## 2. Контракты источника и каталога свойств

Ниже логические интерфейсы; названия transport operations связываются с существующим RPC/command registry после проверки исходников. Не заводить второй transport.

```
SourceDescriptor = {
  ownerId, sourceBinding, entityType, schemaRevision, policyEpoch,
  queryCapabilities, mutationCapabilities, freshness, availability
}
PropertyDescriptor = {
  fieldId, namespace, ownerId, labelKey, typeRef, typeConfig,
  origin: native | custom | relation | derived | agentOutput,
  binding, readable, writable, nullable, schemaRevision
}
QueryWindow = {
  sourceRef, viewRef, fieldIds, filters, sort, cursor, pageSize,
  expectedSchemaRevision, expectedPolicyEpoch, snapshotRequest
}
CellPatch = {
  rowRef, fieldId, expectedRowRevision, typedValue
}
PatchEnvelope = {
  operationId, expectedSchemaRevision, expectedPolicyEpoch,
  previewDigest, patches
}
```

Actor и разрешённый workspace вычисляются из authenticated transport, не доверяются полям payload. Service-agent является отдельным principal.

Adapter предоставляет describeSchema, queryWindow, subscribeChanges, previewPatch, applyPatch и authoritativeReadback только для реально поддержанных операций. Ответ query содержит scoped refs, row revisions, schemaRevision, policyEpoch, snapshotId/cursor, freshness и typed cell states. Unsupported отличен от пустого набора. Query выполняет фильтр/сортировку/агрегацию по всей разрешённой выборке, а не по смонтированным строкам.

Каталог объединяет **описания** свойств существующих owners. Он не сканирует все документы при каждом открытии grid и не копирует значения всех сущностей. Схема соединения/агента берётся из явно объявленных output schemas; свободный текст LLM не создаёт самовольно новый тип поля. Неподдержанный owner получает отдельный adapter task и missingDependency.

Schema events обновляют picker и mapping. Сохранённый view хранит field IDs и свою projection: новые поля автоматически доступны для выбора, но не добавляются в видимые колонки без opt-in auto-include policy. Values выбранных fields обновляются по owner deltas. Rename сохраняет ID; delete даёт typed missing-reference; изменение типа требует preview/migration. Сходные labels разных owners остаются разными свойствами. Отзыв доступа инвалидирует metadata/value caches и подписки.

Реестр #1239 сохраняет согласованные 18 core types до явной versioned migration. Person/agent/team представляются допустимой связью и renderer preset, не незаметным 19-м scalar type. Поле Button согласуется как declarative action-field extension с #1261/#1299; нельзя независимо изменить closed scalar union. Cell states различают value, null, missing, pending, error, redacted и unsupported; redacted не приводится к нулю или пустой строке.

## 3. Host adapter вместо отдельных движков

`HostAdapter` содержит hostKind/version, resolveParentContext, negotiateCapabilities, attachReference, detachReference, serialize, renderPreview, focusBoundary и openFullView. Он не хранит rows или credentials. Для каждого Sxx в registry указываются route/component, owner, формат сохранения, create/read/edit/action capabilities и feature policy. Регистрировать только проверенный active seam; изменения scaffold navigation-registry.ts недостаточно.

TableSurface v1 из первого PR остаётся строгим. Дополнительные host kinds вводятся versioned v2 decoder/adapter, а не ослаблением unknown-key validation. Golden v1 fixtures обязаны декодироваться без смены IDs; старый клиент сохраняет future descriptor без исполнения. Размер descriptor ограничен прежними 16 KiB UTF-8. Новые descriptors не содержат rows, secrets, grants, JS или произвольные URLs загрузки. Cross-workspace ссылки до отдельной утверждённой federation policy запрещены.

### Notes и структурированные документы

Общий Tiptap NodeView вызывает grid host с reference attrs, содержит non-editable chrome и изолирует события клавиатуры активной сетки от родительского редактора. Grid navigation не уничтожает IME composition. JSON/Markdown/HTML serialization определяется отдельно от интерактивного NodeView; неизвестные nodes сохраняются, downgrade выводит безопасный reference или явно выбранный authorized snapshot. Позиция блока не заменяет blockId. Внешняя ссылка, HTML импорт или просмотр файла не исполняют действия.

### Комментарии, чат и Feed

Draft может содержать table reference и создать Base через #1297. Публикация связывает reference с durable parent comment/message revision; пока parent owner не подтверждён, shared editable attachment не объявляется сохранённым. Проверить активный путь NotesPage/document-ia: наличие localStorage helpers в NotesReadingChrome не доказывает canonical storage. Для используемого legacy path нужны scoped migration, preview, backup и readback.

Чтение требует parent + source + row/field policy. Доступ к обсуждению не даёт права на Base. UI показывает bounded preview и явный вход в edit/action mode. Рендер, hover, раскрытие цитаты и восстановление истории не запускают кнопку. Delete/revoke parent убирает attachment, но не удаляет общую Base. Copy/forward сначала проверяет новую аудиторию. Начальная политика вложенности: depth1 для интерактивных table previews, дальнейшие ссылки открываются отдельно; registry обнаруживает циклы.

### Pages и публичные приложения

PageView/PageFrame сохраняют существующий lease по content digest. Доступ к таблице проходит узкий bridge, который проверяет lease, origin/frame identity, definition revision, actor и source policy на каждый запрос. Frame не получает electronAPI, credentials или authority издателя. Snapshot page не превращается в live только от наличия table reference; публикация live query/actions отдельная. Expired lease/revoke обнуляют новые запросы и останавливают subscription.

### CRM, Dossier, Sessions и остальные native surfaces

CRM company/contact/deal schemas и команды различны. Dossier остаётся владельцем единой карточки компании; table open-detail ведёт туда. CRM read-only adapter принимается отдельно от write adapter, но отрицательный blocked test не закрывает финальное требование реального редактирования. Native write должен иметь provider/native receipt и проверку во второй поверхности.

Sessions сохраняет SessionMeta, filter/order/rank, существующий selection и native preferences. Общий grid заменяет представление через adapter постепенно, с регрессией SessionTableHost; нельзя превратить сессию в CustomRecord. Tasks/Projects/Calendar/Meetings/Mail/people/agents проходят аналогичную отдельную owner certification. ROX Home и Conation Dashboard используют общий widget/query primitive, но остаются разными host compositions.

## 4. Records и Sheet: явная семантика

Records: строка — entity/custom record; колонка — typed property. Formula field задаётся на колонку, derived values read-only. Не допускаются произвольные ручные значения в отдельных derived cells без явного override field.

Sheet: строка/колонка имеют стабильные IDs; ячейка может содержать literal либо FormulaAST. A1 notation — пользовательский адрес поверх row/column mapping, не entity identity. При copy/fill relative references смещаются по формальным правилам; `$` фиксирует соответствующую ось. Sort presentation не меняет entity target. Structural insert/delete имеет собственную revision и обновляет address mapping; удалённая reference даёт REF error. Named ranges хранят IDs, а не только display labels. Spill conflicts дают явную ошибку, не перезапись существующих значений.

Sheet bindings на native properties только read-only до явного publish/apply-mapping с preview, field ACL и expected revisions. Значения формул не выполняют обратную запись в CRM/Task автоматически. Переключение Records/Sheet не является молчаливой миграцией данных; режим/совместимость видны пользователю.

CSV/XLSX compatibility matrix по #1284 перечисляет реально поддержанные функции, ranges/names, decimal/date systems, styles и неподдержанные objects. VBA, внешние workbook links и arbitrary macros не исполняются. Loss report обязателен. Строка, начинающаяся с `=`, не становится исполняемым выражением при импорте без выбранной политики.

## 5. Формулы и инкрементальный пересчёт

Pipeline: parse → typed AST → bind stable refs → validate budgets → dependency graph → authorized evaluation → result revision → presentation. Один versioned interpreter используется для grid, filter, chart, export и rule predicates. No eval/Function, globals, network, filesystem или прямой provider call.

Числа: тип/precision задаются registry; money сохраняет decimal/scaled semantics, не округляется по display format. Dates различают date-only и instant; timezone фиксируется evaluation context. NOW/TODAY используют один pinned evaluationTime; обновление time-dependent results идёт явным clock tick, а не новым Date.now() в каждой клетке. Legacy четыре Note formulas сохраняют прежние counts/checkbox semantics.

Dependency graph индексируется по sourceRef+fieldId+rowRef и диапазонам. Owner delta помечает только зависимое подмножество dirty. Для агрегатов нужен incremental index или явно ограниченный rebuild, не полный renderer scan на каждый keystroke. Cross-table lookup выполняется пакетно и permission-aware, не N+1 запросами. Циклы выявляются до publish либо при dynamic binding; диагностика не раскрывает недоступные имена/значения.

В renderer работает cancellable worker для preview/локального кеша; authoritative queries/derived filters выполняются у data-plane owner тем же evaluator/version. Result содержит evaluationId, input revision vector, schemaRevision, policyEpoch и snapshotId. Поздний worker result со старым epoch/revision отбрасывается. Несогласованные remote sources помечаются freshness/revision vector; нельзя обещать глобальную транзакционную snapshot из независимых providers.

State: clean → dirty → queued → computing → clean/error; invalidated/revoked результаты не показываются как свежие. Errors: REF, TYPE, DIV_ZERO, CYCLE, BUDGET и недоступная dependency; UI показывает безопасную причину и переход к доступному источнику. Budgets AST depth/size, rows, fanout, elapsed time и memory проверяются в worker И на сервере. Backfill chunked с checkpoint/cancel; hidden embed может остановить preview, не теряя persisted definition.

## 6. Автоматизация ячеек — не побочный эффект формулы

| Механизм | Исполнение | Что сохраняется |
|---|---|---|
| Default/validation | Явная create/edit command | Typed value + receipt |
| Formula/lookup/rollup | Чистый evaluator | Definition + rebuildable result cache |
| Conditional formatting | Чистое правило представления | Versioned rule/token config |
| onChange/threshold/time rule | Существующий durable automation runtime | Published rule, run, effect receipts |
| AI enrichment | Async job через существующие providers/session runtime | Input digest, proposal/result, usage, approval, apply receipt |

Нормальный порядок: native commit + recoverable outbox → authorized deltas → affected calculations → committed rule input → durable workflow. Optimistic UI values не запускают внешние эффекты. Rule определяет event origins и тип перехода: changed / enters-condition / leaves-condition, а не повторный запуск на каждом чтении true. Импорт/backfill/replay по умолчанию не вызывают внешние эффекты; включение требует явной review policy.

Envelope содержит correlationId/causationId/rootEventId/producer/operationId и event revision. Dedup по logical event/effect identity, причинный лимит глубины и budget на один root предотвращают циклы A→B→A. Coalescing допускается только для правил с явно выбранной семантикой latest-state; ledger transitions не теряются. Formula-only update не считается новым пользовательским edit. HTTP/SMTP/Slack unknown outcome уходит в reconciliation, а не blind retry; exactly-once внешнего мира без provider поддержки не обещается.

AI cell не является volatile formula: input refs/revisions, model/connection/prompt/schema versions, budget/approval фиксируются. Результат — typed proposal; применение отдельно через native CAS. Auto-apply разрешается только заранее настроенной политикой в допустимые поля. Ошибка/quota/cancel/stale input видны в ячейке. Secret memory и закрытые свойства не включаются в prompt. Двойное открытие grid не создаёт второй AI job.

Button имеет immutable published definition, row/selection context, expected revisions и ordered typed outputs. Preview не исполняется. Открытие URL — последнее клиентское действие после нужных подтверждённых шагов; reload не повторяет переход. Внешнее исполнение продолжается независимо от закрытия embed, если пользователь явно не отменил run. Undo данных не выдаётся за отзыв уже отправленного письма.

## 7. Grid kernel, производительность, память

Переиспользовать существующие native selection/reorder semantics, а не слепо заменить все таблицы новым компонентом. Общий kernel реализует двухосевую виртуализацию, field renderer registry, overlays, selection по refs и один активный editor. Renderer получает window+projection, не все100k×50 cells. Sort/filter/group/summary выполняются по authorized query; totals не ограничены visible page.

Cached window имеет bounded LRU; page cursors привязаны к schema/policy/snapshot. Отменённый запрос не обновляет более новый view. Редактируемый cell editor не remount-ится при scroll/IME; выборка обновляется delta batches, а не setState полного workbook. Formula/parser/import code грузятся по необходимости, не блокируют первый пустой grid.

Все embeds документа используют общий resource scheduler: видимые interactive windows получают приоритет, offscreen previews не запускают полные queries/workers. Shared query cache разделяется только при совпадении actor/policy/source/snapshot/projection; authority-wide cache нельзя выдать viewer. Unmount снимает leases/subscriptions/listeners; сохранённый draft отделён от component lifetime. Целевые бюджеты и измерения — G09, не заявленная скорость текущего кода.

## 8. UI/UX contract

Текущие background/foreground/accent tokens — источник темы. Новые table tokens: divider, hover, selection, focus, tagTint, conditionalTint, stickySurface; их значения выводятся из темы. Начальные визуальные ориентиры: tag/conditional tint6–12%, hover3–5%, selection8–12%; это не жёсткое требование при недостаточном контрасте. Не наслаивать произвольные opacity на текст. Error/readonly/pending различимы также текстом/иконкой.

Sticky header/column имеет непрозрачную базу цвета поверхности и слабую tint-плёнку; иначе текст прокручиваемых строк просвечивает и двоится. Z-order: body → pinned cells → headers/corner → active editor/popover; selection/focus остаются видимыми поверх условного окрашивания. Не применять backdrop-filter/blur к каждой ячейке или тысяче строк. Декоративное стекло допустимо только на ограниченном chrome и после profiler gate.

Compact row32px, comfortable40px; touch target44px через touch mode. Меню/resize имеют keyboard alternative. Числа выровнены и используют tabular numerals, длинный текст не меняет неожиданно высоту тысяч строк; wrapped mode отдельный. Переносится исходная компактная навигация, не универсальная сетка карточек вместо CRM/Notes.

Keyboard: один вход Tab в grid, arrows между cells, Home/End и Ctrl/Cmd варианты, F2/Enter edit, Esc отменяет edit перед выходом из host; Shift-selection, copy/paste/fill/undo через общий command path. Не перехватывать IME composition и системные shortcuts вне grid. Focus stable по refs, подписи для screen readers, 200% zoom и reduced motion обязательны. Header resize/column move доступны без мыши. Основные действия не hover-only.

Paste/fill сначала строит typed preview с eligible/invalid/readonly/conflicting cells и frozen target refs/revisions. Batch across owners возвращает per-cell receipts/partial outcomes, не выдуманную общую атомарность. Undo — новый компенсирующий запрос с проверкой текущих revisions; чужие правки не стираются.

## 9. Безопасность, миграции и наблюдаемость

Read/query/filter/formula/chart/export/clipboard/AI/frame/action используют одни owner policies. Parent ACL пересекается с source ACL; grants не суммируются. Revoke invalidates subscriptions, indexes, preview and result caches, queued dispatch перед следующим эффектом. Уже скачанные файлы физически отозвать не обещать. Errors/logs/traces не содержат secret input, недоступные titles/counts и raw provider responses.

Миграции versioned: source preview/hash → typed mapping/loss report → staging → validation → canonical commit → host CAS → readback. При нескольких owners хранить recoverable intent и reconciliation, не удалять якобы orphan Base, уже используемую другим host. Старые Notes localStorage views переходят в Page-owned definitions с backup и неизменными legacy formulas. Private preferences не превращаются молча в shared config.

Tracing связывает hostId/tableRef/query/evaluation/run/command; метрики query p95, mounted cells, worker recompute size, queue lag, stale results dropped, conflicts и provider reconciliation. Отдельно source-empty/filtered-empty/denied/unsupported/offline/stale. Для аналитики не отправлять содержимое ячеек по умолчанию.

## 10. Первичные технические референсы

- Tiptap React NodeViews: https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react
- NodeView и отдельная сериализация: https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views
- W3C APG Grid: https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- Baserow Button field: https://baserow.io/user-docs/button-field

Это ориентиры интерфейсов и поведения, не утверждение, что ROX уже их реализует или полностью повторяет ограничения Baserow. Все новые seams, compatibility и gates привязаны к actual implementation SHA при приёмке.
