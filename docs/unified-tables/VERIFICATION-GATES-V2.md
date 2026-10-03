# Единые таблицы — verification gates v2

Дата: 2026-09-30. Нормативная приёмка #1312 для [PRD-V2](PRD-V2.md) и [TECH-SPEC-V2](TECH-SPEC-V2.md). Все численные performance значения ниже — **целевые бюджеты, не измеренные достижения**. Публикация документа не означает PASS product gates. Исторические54 codec tests не заменяют формулы/CRM/native UI.

## 1. Статус и доказательство

Разрешённые статусы gate: NOT_RUN, RUNNING, PASS, FAIL, BLOCKED. SKIPPED и отсутствие реализации не преобразуются в PASS. NOT_APPLICABLE допускается только для заранее описанной неподдерживаемой операции конкретного host: например, просмотр внешнего письма не должен исполнять Button. Это не исключает требуемую поверхность или обязательный backend из общего scope.

Для каждого результата сохранить: requirementId, surfaceId, capabilityId, issue, implementation SHA, base SHA, schema/runtime versions, environment/hardware, exact command, fixture/seed, expected/observed, elapsed, artifacts+SHA256, native/provider readback, негативные контроли и все attempts. Успешная повторная попытка не скрывает предыдущий failure. Код и evidence должны соответствовать одному head либо содержать доказанную совместимость.

Проверочные lanes разделены: source audit; pure unit/contract; server-owner integration; native Electron/WebUI; real authorized provider; performance; независимый review. Mock success, UI toast, screenshot и provider queued status не являются authoritative commit.

## 2. Матрица охвата

Сохранить все S01–S23 из PRD. Для каждого: exact route/component; active feature policy; canonical owner; allowed create/reference/read/edit/action; definition/data storage; schema and value subscriptions; serialization; ACL; issue; proof status.

Роли: owner/editor/viewer/service-agent/guest. Каналы: UI/clipboard/API/workflow/agent/form/export/realtime/frame. Попарное покрытие уменьшает комбинации, но **не заменяет обязательные опасные пересечения**: guest+frame+hidden field; agent+derived dependency; comment+different audience; clipboard+mixed owners; export+revoked access; CRM+unknown provider outcome.

Все U1–U6 из PRD обязательны. S01–S23 нельзя свернуть в три origins и объявить полное покрытие. Gate каждого adapter включает реальный owner readback для заявленной записи; unsupported write имеет отрицательный тест и остаётся blocker положительного требования до реализации.

## 3. Обязательные gates

| Gate | Что проверяется | Семантический отрицательный контроль |
|---|---|---|
| G00 — source/readiness | Свежие refs, routes и owners; active vs scaffold/dormant; все23 поверхности связаны с issue и seam; PR/base статус | Добавить запись registry без активного route/owner: inventory validator обязан отклонить readiness |
| G01 — contracts | v1 golden roundtrip + v2 hosts; scoped IDs, strict unknown keys,16KiB; server schema validation; supported types и feature negotiation | Убрать account namespace или принять grants/rows в descriptor — тест падает |
| G02 — persistence | Canonical definitions/data; create/attach CAS; two-client/restart; native receipts; partial outcomes/undo/reconciliation | Crash после Base commit до parent attach; повтор создаёт вторую Base — тест падает |
| G03 — property discovery | Owner schema → authorized catalog → picker; selected values by delta; rename/delete/schema change/revoke | Rename меняет field identity; закрытый field появляется в picker; scan всех documents при одном delta — FAIL |
| G04 — formulas | Typed AST/relative/absolute/ranges, legacy values, pinned context, cycles/budgets, dirty graph, same authorized query/chart/export | Пересчитать только viewport aggregate; принять late result старого policy; eval/network в формуле — FAIL |
| G05 — grid/UX | Native edits, paste/fill/undo; stable refs/focus; IME; two-axis virtualization; themes/transparency/sticky/keyboard/a11y | Resort меняет target cell; IME remount теряет ввод; tint скрывает focus; readonly paste пишет — FAIL |
| G06 — actions | Committed triggers, Button outputs, loops/Response/cancel, AI jobs, mail gateway; durable receipts/restart/retry | Render запускает действие; effect ACK crash приводит к повторной отправке; cancel пропускает следующий dispatch — FAIL |
| G07 — security | Parent∩source∩row/field ACL; frames/agents/forms/export; policy epochs; SSRF/redaction; no privilege union | Viewer получает owner cache; formula error выдаёт hidden value; forwarded comment расширяет grant — FAIL |
| G08 — migration/sync | Markdown/legacy/CSV/XLSX/Airtable explicit mapping; loss report, versions, source scope, staging/checkpoints | Потерять leading zero/unknown formula; выполнить imported action; подменить subset полной базой — FAIL |
| G09 — performance | Зафиксированный hardware/fixture, cold/warm p95, bounded memory/network/DOM/worker,20 embeds,10 writers | Отключить row/column windowing или пересчитать весь graph при local delta: profiler/semantic budget падает |
| G10 — integrated release | Все обязательные claims23 hosts, U1–U6, regression/native/provider gates и independent review на actual SHA | Green unit suite при missing native CRM/Doc/comment capability не допускает release |

Отрицательный контроль считается пойманным только при ожидаемом semantic assertion, а не при import error, timeout инфраструктуры или отсутствии пакета. Требуются зелёный baseline и управляемый mutant. Security/identity/no-data-loss требования абсолютны и не имеют performance tolerance.

## 4. Формулы: конкретные проверочные наборы G04

Records: nullable numbers, exact configured decimal money, dates/date-only/timezone, text/booleans, denied/missing/error/pending. Четыре legacy Notes built-ins сверить с неизменёнными fixtures. Field rename сохраняет AST refs; deleted field даёт REF, не подстановку соседней колонки.

Sheet: relative/absolute/mixed references, fill rectangle, structural insert/delete, named range rename, sort presentation, spill collision. Cross-table lookup/rollup проверяется по всем разрешённым строкам и диапазонам, не текущей странице. Разные account namespaces с одинаковым remoteId не смешиваются.

Incremental oracle сравнивает full recomputation с incremental на одном seed/snapshot и измеряет visited nodes. Для fixture из100k строк local change с1000 зависимостями не посещает все5M cells. Cycle/fanout/depth/time budget даёт typed error. Stale worker result со старым epoch не появляется в UI. Pinned NOW одинаков для grid/chart/export; скрытый dependency не раскрывается в результате или error metadata.

## 5. UI/UX gate G05

Проверять настоящее приложение, а не только isolated component. Матрица: light/dark; русские строки и все затронутые locale keys;100%/200% zoom; keyboard/pointer/touch; reduced motion; screen reader grid labels; открытая/закрытая sidebar; узкий comment embed и full view.

Проверки: F2/Enter/Escape и Arrow/Tab; раздельный фокус host editor/grid; IME composition; copy/paste multilineUnicode/decimal/date; fill preview; resize/reorder клавиатурой; undo после concurrent edit; sorting/filtering/grouping с активным editor; explicit unsupported/read-only state. Числовые значения доступны текстом, не только canvas.

Снимки и computed styles: мягкие tags/cell tints, различимые selection/focus/error, читабельный sticky header без просвечивания текста строк, no per-cell blur. Проверить фактически используемые font/theme tokens, не только наличие CSS declaration. Compact32/comfortable40/touch44 не обрезают текст и controls. Сначала проверить поведение, затем визуальный regression; красивый screenshot не закрывает data gate.

## 6. Измеримые бюджеты G09

Первый reference environment для согласования: Apple M1/16GB,60Hz, локальный indexed storage, viewport1440×900,100%zoom, production build без devtools. Это **предложенный профиль**, не утверждение доступного runner или проведённого теста. CI hardware фиксируется отдельно и получает собственную baseline; результаты разных машин не смешиваются. Версии OS/Electron/WebUI/Bun и build SHA обязательны. Удалённая query lane отдельно: RTT100ms,20Mbps, synthetic controlled source; local SLO не выдаётся за remote.

Fixtures с фиксированным seed: F1=10k rows×30 fields; F2=100k×50 logical cells, nullable/text/select/date/relation/formula mixture; F3=1000-cell paste; F4=1000 affected formula nodes среди F2; F5=20 table embeds в документе; F6=10 concurrent writers. Field mix/длины строк/schema/graph topology публикуются вместе с seed. В UI не материализуется весь F2.

| Метрика / граница измерения | Целевой бюджет | Как фиксировать |
|---|---|---|
| Warm usable grid: вызов open→первый разрешённый viewport принимает focus/edit | p95≤500ms |100 warm opens, query cache разрешён только current policy |
| Cold local: запуск открытия с холодным table cache→usable viewport | p95≤1500ms |30 независимых открытий, OS cache policy явно записана |
| Authorized query page: отправка→получение десериализованной страницы | p95≤1000ms |100 запросов F2, local и remote lane раздельно |
| Cell interaction: key/pointer→следующий paint draft | p95≤50ms |1000 edits; отдельно authoritative ACK latency, draft не success |
| Incremental F4: accepted delta→готовый current-revision result batch | p95≤100ms local |100 seeded edits; visited nodes/worker time/queue time отдельно |
| Scroll F2: dropped frames на60Hz при30s пути | ≤5% dropped; main-thread work p95≤8ms |production trace, identical path, no silent frame skipping |
| Paste F3 preview | p95≤200ms local |typed validation preview; apply/native receipts измеряются отдельно |
| Resident render cells | ≤2500 при данном viewport |DOM/render counters; не считать скрытые canvas buffers бесплатными |
| Row page/cache bounds | page≤200rows; resident≤2000rows по активному resource pool |LRU/cache instrumentation; projection fields и page payload≤1MiB |
|20 embeds F5 | inactive не запускают full queries/evaluation; incremental renderer heap≤200MiB над baseline |одновременно3 visible, bounded preview остальных; shared resource pool |
| Cleanup | после20 mount/unmount циклов retained heap≤baseline+10% при одинаковой GC процедуре |heap snapshots/listener/subscription/lease counts; RSS отдельно |
| Concurrency F6 |0 lost acknowledged writes;100% revisions/partial outcomes объяснимы |authoritative state digest до/после restart; latency/conflicts отдельно |

Бюджет может быть пересогласован по измеренной baseline и продуктовому решению, но не молча ослаблен для зелёного CI. Общий timeout в тесте не заменяет p95. Медиана, p95, p99, число выборок, все traces и ошибки сохраняются. Отдельно мерить cold parser/worker chunk load; full100k formula backfill имеет progress/checkpoint и отдельный отчёт, не блокирует первый viewport.

## 7. Сценарии crash/concurrency/security

Барьер1: parent conflict после Base commit; барьер2: native value ACK до projection update; барьер3: provider ACK до durable checkpoint; барьер4: cancel intent одновременно с dispatch; барьер5: schema rename во время paste/AI; барьер6: revoke при запущенном formula worker; барьер7: reconnect старого cursor после sync mapping update.

Каждый сценарий проверяет logical identities, expected revisions, duplicate prevention, truthful partial outcome и повторный readback. Нельзя лечить unknown provider outcome новой idempotency key. Preview/render/import по умолчанию не имеют внешнего эффекта. CRM blocked adapter даёт0 writes; положительный CRM write остаётся обязательным отдельным сценарием до заявления готовности.

## 8. Разрешение release

Для product release нужны G00–G10 по заявленному scope; обе стороны source/host проверены, native/provider lanes не заменены unit. Если конкретный public host по контракту read-only, это фиксируется до тестов. Отсутствующая обязательная CRM/комментарий/формула capability — BLOCKED, не NOT_APPLICABLE.

Текущая ревизия: source audit и спецификации опубликованы; implementation/native/provider/performance для V2 NOT_RUN. Исторический код v1 codec имеет отдельные старые unit evidence в VERIFICATION.md. Его54/54 нельзя переносить на новую матрицу. Draft PR сохраняется до собственного review; этот документ не включает автоматическое merge/release.
