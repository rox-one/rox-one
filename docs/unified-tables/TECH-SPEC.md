# Техническая спецификация — Unified Tables / UTB

**Epic:** [#1295](https://github.com/rox-one/rox-one/issues/1295). **Baseline:** `f63294ba4fffa7238b46b24e918925a313ad0b12`. Все API ниже, кроме явно выделенного UTB-01, — предлагаемые contracts для реализации, а не утверждение о существующих endpoints.

## 1. Источники и проверенное основание

На baseline прочитаны `AGENTS.md`, `packages/core/CLAUDE.md`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/rox2/platform-contract.ts` и `apps/electron/src/renderer/pages/notes/note-views.ts`. В core/src на этой revision отсутствовал каталог bases. Текущий NoteBaseView v1 — проекция Notes: фильтры eq/includes/exists/gt/lt, columns/groupBy/sort и ограниченные формулы taskCount/openTaskCount/backlinkCount/tagCount. Это не подтверждает наличие общего persistent typed Base engine.

Предыдущие проектные решения прочитаны из [LSX Base design](https://github.com/rox-one/rox-one/blob/242492868a11b4d9af1c1011f20b31a346875f0a/docs/lark-suite-reference/05-rox-bases-design.md) и связанных issues. Этот документ отсутствовал на проверенном main; перенос всех прежних веток не является частью текущего PR. Existing integration seams из прежних specs должны быть заново прочитаны на выбранной implementation revision перед patch.

Референс поведения — пользовательские скриншоты, карта R1 в PRD. Публичная [лицензия Baserow](https://github.com/baserow/baserow/blob/develop/LICENSE) имеет разные условия по каталогам, отдельное правило для client JavaScript и third-party components. Этот пакет не содержит заимствованного кода, документов или изображений Baserow; дальнейший reuse — только после отдельного анализа конкретных файлов и сохранения notices.

## 2. Разделение ответственности

```text
Standalone Table / Note block / Doc block / Dashboard / Application
                          |
                 TableSurfaceDescriptor
                          |
         Shared renderer + query/command adapters
                          |
      Canonical BaseDefinition + SourceAdapterRegistry
        /                 |                       \
  Native Notes       Native Tasks/...        CustomRecord owner
        \                 |                       /
             Existing identity / commands / outbox
                          |
          Existing automation and provider runtime
```

BaseDefinition владеет schema/query/view/action references; native данные остаются у Notes/Tasks/Calendar/другого исходного owner. Для пользовательской пустой таблицы нужен CustomRecord owner, интегрированный с Page identity согласно #1235/#1231; он не является зеркалом существующего Task. Renderer и embed не владеют authoritative rows. Query index/cache может быть перестроен и не становится вторым источником записи.

Existing `PageKind=static/interactive/live` сохраняет своё значение. Тип content descriptor — отдельное additive поле/adapter по #1231. Не добавлять новый глобальный entity kind без общей миграции identity. Все ссылки включают workspaceId, entityId, optional revisionId и accountNamespace из существующего Rox2EntityRef.

## 3. Логическая модель данных

| Объект | Минимальные атрибуты | Владелец / правило |
|---|---|---|
| BaseDefinition | baseRef, schemaVersion, definitionRevision, tables, sourceBindings | canonical Page owner; persisted по #1235 |
| TableDefinition | tableId, fields, defaultViewId, sourceBindingRef | часть Base schema; стабильный tableId |
| FieldDefinition | fieldId, type, label, type options, constraints, policyRef | labels изменяемы, bindings используют IDs |
| ViewDefinition | viewId, type, query, columns, groups, sorting, layout, scope | shared revision отдельно от personal prefs |
| Row | native entityRef, rowRevision, typed values/provenance | actual source owner; derived values не writable |
| Surface descriptor | Base/Table/View refs, host/block, mode, presentation | host document/page; только ссылки |
| Action definition | stable action/step IDs, immutable revision, typed bindings | existing action/workflow definition owner |
| Run/StepReceipt | runId, version, state, attempt/iteration, result, effect key | existing durable runtime, не localStorage |
| FieldPolicy | principals, operations, policyRevision/epoch | existing identity/policy owner |
| SyncJob | binding/config revision, checkpoint, counts, state/error/fence | existing job owner |
| Publication | source/field/action whitelist, guest policy, quota ref | existing Forms/Application publication |

Физический storage adapter выбирается по реальному owner в implementation baseline. Здесь не объявляются несуществующие PostgreSQL/SQLite таблицы или Redis очереди. Требование — durable CAS/receipt/outbox boundaries и проверка restart; неподтверждённая atomicity не должна появиться в UI.

## 4. Реализуемый сейчас контракт UTB-01

Путь: `packages/core/src/bases/`; public export `@rox/core/bases`.

```json
{
  "version": 1,
  "type": "rox-table",
  "baseRef": {"workspaceId":"w1","entityId":"page:base1","accountNamespace":"work"},
  "tableId":"table1",
  "viewId":"grid1",
  "host": {"kind":"note","ref":{"workspaceId":"w1","entityId":"note:n1"},"blockId":"b1"},
  "mode": {"kind":"live"},
  "presentation": {"density":"compact","height":480,"showToolbar":true}
}
```

Host kinds: standalone; note/document/dashboard/application с отдельными ref/blockId. Snapshot mode содержит snapshotId и всегда read-only в availability. Сам codec не создаёт snapshot и не обещает, что schema revision замораживает все строки. SnapshotId разрешается и авторизуется query owner отдельно.

`createTableSurface` добавляет version/type/live default и возвращает detached validated descriptor. `encodeTableSurface` проверяет runtime shape и сериализует только v1. `decodeTableSurface` выдаёт valid, invalid с безопасным кодом либо unsupported-version с точной исходной строкой. Raw future payload нельзя исполнять, индексировать как разрешённый v1 или незаметно перезаписывать старым клиентом.

Максимальный serialized размер — 16 KiB UTF-8, проверка до JSON parse. ID: непустая строка до 1024 UTF-16 code units, без внешних пробелов и управляющих символов; Unicode сохраняется. Неизвестные v1 properties, embedded rows, tokens, grants и scripts отклоняются, а не молча удаляются. Presentation: density compact/comfortable; целочисленная height 120–2400; boolean showToolbar. Cross-workspace host/base отклоняется до отдельного будущего federation contract.

`retargetTableSurface` сохраняет source и меняет только проверенный host. `tableSourceKey` — JSON tuple workspace/account/entity/table, без view/host/revision. `tableQueryKey` добавляет view, optional base revision и live/snapshot identity. Это НЕ готовый permission-aware cache key: server cache дополнительно включает actor, policy epoch, schema/source/query revisions и фильтры.

`getTableCapabilityAvailability` — presentation metadata, НЕ авторизация. Input evidence берётся из текущего server context. Source/host denial закрывает все операции; unsupported schema закрывает взаимодействие; snapshot/read-only host закрывают mutations; затем требуется runtime=true И grant=true для каждой capability. Truthy строки и унаследованные свойства не считаются true. Даже available=true требует независимой проверки на actual owner при каждом read/apply. Эту функцию нельзя использовать как серверную проверку Form submissions.

## 5. Создание и привязка

Предлагаемая команда `table.create` принимает source selector либо custom schema, hostRef/blockId, expectedHostRevision, operationId и client idempotency key. Actor определяется authenticated transport. Сервер проверяет права на создание Base, выбранный source и attach к host; генерирует стабильные IDs и durable creation intent; создаёт Base/initial table/default grid; прикрепляет descriptor через host CAS; выдаёт раздельные receipts и authoritative refs.

Если storage owner общий, возможно использовать его атомарную транзакцию. Если owners разные, нужен recoverable state machine: reserved → baseCreated → attached → committed либо reconciliationRequired. Retry продолжает intent с теми же refs. Ошибка attach не означает, что Base не создана; нельзя создавать дубль при timeout или автоматически удалять Base, на которую уже существует другая ссылка. Abandoned intent доступен для восстановления/проверенного cleanup по retention policy.

Удаление embed удаляет только host block. Удаление Base — отдельная подтверждённая audited операция с tombstone и учётом references. Остальные embeds становятся безопасно unavailable. Duplicate-as-reference и duplicate-data — разные commands; второй создаёт новые canonical refs и не включает импортированные actions.

## 6. Source adapters, query и writes

Общий adapter предоставляет schema/capabilities/query/preview/apply/readback/subscribe в пределах поддерживаемых операций. Native Notes свойства записываются через существующий notes owner, Task — через native Task command, Calendar — через source binding. Read-only integration не получает фиктивного write path. CustomRecord использует собственный canonical owner, но общие identity/ACL/commands.

Query request содержит base/table/view refs, typed field-ID expression tree, cursor, limit и expected definition/schema revision. Server разрешает actor/grants до filter/sort/formula/aggregate, возвращает rows, exact refs/revisions, next cursor, source freshness и authorized totals. Cursor привязан к query snapshot и permissions; произвольное изменение cursor отклоняется. Stable tie-breaker — canonical entity ref, не визуальный индекс. All-page aggregate не считается по visible grid page.

Mutation envelope: operationId, idempotencyKey, target refs, expected schema/row revisions, typed patch, reviewed previewDigest, authorityEpoch где owner поддерживает. Server заново проверяет текущие права, schema и digest, затем commit/receipt/outbox в recoverable boundary. Не доверяет actor/workspace/owner из клиентского payload. Ошибки разделены: validation, denied, conflict, deleted, offlineUnsupported, missingDependency, unknownFormat, rateLimited. Responses не отражают secrets или защищённые поля.

Batch paste возвращает per-cell/row outcome по явно выбранной atomic/partial политике. Undo — новая компенсирующая command с expectedRevision, не перенос курсора в памяти. Realtime сообщения содержат refs/revisions и безопасную invalidation; actual body перечитывается с текущими правами. Revoke закрывает subscriptions и последующий dispatch.

## 7. Schema, формулы, связи и группы

Типы и редакторы из #1239/#1253 — один registry для всех surfaces. Состояния null/empty/error/redacted/unsupported не смешиваются. Numeric precision и date-only/timezone не нормализуются молча. Formula parser/interpreter #1256 не использует eval; имеет depth/step/time budgets, зависимости по fieldId и pinned evaluation time. Rename не ломает выражение, deletion invalidates publish.

Relation/Lookup/Rollup используют независимые target policies и не раскрывают запрещённые данные через count, filter, sort или tooltip. Cache не переиспользует owner aggregate для viewer. Schema changes имеют preview/loss report, revision fence и восстановление; type cast с потерями требует подтверждения.

Group Sections/Columns — layout той же выборки. Move между writable single-value группами — native field mutation и ordering receipt. Для formula/multiselect/readonly групп неоднозначный move запрещён или требует явного mapping. При explicit sort manual order отключается либо выбирается отдельный режим; временное DOM перемещение не выдаётся за сохранённый порядок.

## 8. Автоматизации и внешние эффекты

Button field ссылается на immutable action/workflow revision. Bindings читают row.fieldId и предшествующие stepId.output.path; forward refs и type mismatch блокируют publish. Imports всегда inert до review. Один dispatcher через #1261/#1276/#1098 выполняет команды, HTTP, email, Slack, nested workflows. OpenURL проходит safe client dispatcher, не серверный fetch.

Run фиксирует definitionVersion, trigger/correlation, principal, inputs refs/digest, startedAt, state и budgets. Step receipt различает logical operation, transport attempt и business iteration. Idempotency key сохраняется при повторе доставки/transport retry. Если provider ACK мог произойти, но результат неизвестен, требуется reconciliation или explicit manual policy; нельзя обещать универсальный exactly-once для внешнего API без его поддержки.

Go to имеет допустимый destination, typed condition и bounded loop frame. Начальные предлагаемые policy defaults: 100 iterations, 15 минут, 1000 dispatched steps; настраиваемы и отдельно проверяются сервером. Backoff/Retry-After использует scheduler wait/checkpoint, не busy loop. Смена graph version не меняет уже запущенный run.

Response возвращает один HTTP ответ с безопасными status/body/headers или typed child result. Long-running route использует существующий async handle/202 и ACL на чтение результата. Повтор Response/конкурирующие ветки диагностируются; disconnect не стирает durable result.

Cancel фиксирует cancelRequested с revision/fence. Текущий шаг может завершиться; после принятой fence следующий не dispatch. Abort поддерживается только там, где это реально делает adapter. Cancellation не откатывает отправленный email или выполненный HTTP. History показывает confirmed/unknown/partial outcomes; secrets и закрытые field values редактируются.

## 9. Mail, AI, sync и import

Email trigger требует реально готового incoming gateway: verified provider webhook либо локальный SMTP adapter, настроенные адреса/доставка/подписи/лимиты. До этого missingDependency. Test и production addresses разделены, rotation отзывает старый. Dedup включает provider/account/deliveryId и hash; Message-ID не является достаточной гарантией. MIME и attachments остаются у canonical mail/file owners, проходят size/rate/quarantine правила. Текст письма недоверенный, не инструкция управляющему агенту.

AI использует существующий connection/model registry и secrets store. Context — selected permitted rows/fields, не полный Base. Structured output валидируется; apply требует текущую revision, native command и effect approval. Model retry не повторяет patch. Учитываются budgets/usage/egress; disabled/revoked provider не подменяется скрытой внешней моделью.

SyncJob сохраняет binding/config revision, cursors, lease, counts, progress, error и freshness. Источник идентифицируется provider+account+remoteType+remoteId. Resume идемпотентен, schema drift проверяется, native edit vs remote edit имеет явный conflict report. Mapping/history не превращаются в копию native row store.

Airtable import использует общий staging/preview/apply engine #1284. Public view scope не расширяется до скрытой полной базы; auth-only источник сообщает необходимость доступа. URL/redirect/DNS/IP/attachment policy не допускают SSRF. Формулы, actions и permissions, которые невозможно перенести, отмечаются loss report; результат не называется полным клоном. Commit подтверждается count/hash/mapping readback на реально прочитанном source subset.

## 10. Dashboard, каталог и публикация

Dashboard layout принадлежит existing Page, source data — Base. Widget IDs и positions устойчивы, responsive/keyboard эквивалентны drag. Graph/Table/KPI используют один authorized query и совместимые revisions. Drill-down возвращает ровно разрешённые contributing rows.

Catalog contribution добавляет Base/View/Dashboard в existing resources/recents/search. Recents actor-scoped, не authority. Нельзя хранить stale title/preview после revoke. Session открывается явным действием со scoped refs, не автоматически на hover.

Publication фиксирует source/field/action whitelist, guest scope, expiry/revocation и optional quota policy. Form-create не даёт read/update всей таблицы. Quota scope/window/counter/warnings/grace задаются deployment policy и проверяются атомарно на сервере. Число 500 из коммерческого Baserow не является обязательным ограничением ROX. Публикация выключена до server security gates.

## 11. Миграции и совместимость

NoteBaseView v1 мигрирует только через #1250, сохраняя semantics четырёх текущих formula expressions, существующие columns/filters/sort/groupBy и собственные preferences. Новая schema не перезаписывает старые notes при чтении. Source Markdown/YAML сохраняется lossless через #1238; promotion привязан к blockId/span hash и source revision.

Unknown future descriptor сохраняется byte-for-byte как unsupported read-only payload. Старый клиент не должен его сериализовать обратно через v1 writer. Downgrade/feature disable не удаляет Base или embeds; router показывает безопасную unsupported карточку. Rollback UI deployment не считается rollback native данных или внешних эффектов.

## 12. Приёмка и доказательства

Unit, server integration, native UI и live provider — четыре отдельные proof lanes. Node unit pass первого core module не доказывает Bun/downstream compatibility, сохранение Base, Editor mount, HTTP/mail delivery или full parity. Exact commands, code/input hashes, fixture seeds, environment и readback сохраняются отдельно. Negative controls должны падать на semantic assertions, а не потому, что не установлен runner.

Полная матрица #1312: три origins × пять ролей × каналы UI/API/workflow/agent/form/export; два клиента, restart, concurrent edits, revoke, schema drift, network ambiguity, import loss и adversarial inputs. Наличие controls без действующего owner/runtime не считается реализацией.
