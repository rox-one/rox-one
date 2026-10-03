# Независимая проверка product issues — Revision 4

Дата: 2026-09-30. Проверены генератор `scripts/rox-suite/build-product-drafts.mjs`, десять опубликованию подготовленных bodies в `docs/rox-suite/issue-drafts/product/`, их manifest и `plans/macro-integration/resolved-operation-contracts.json` (17 операций, 18 привязок форм). Source baseline ROX: `249b3b44220bcfbd7d467de9cfc18f76e1c37807`.

Это проверка спецификаций и исходников. Новый продуктовый runtime не реализован; failing E2E существующего продукта не заявляются. Ниже блокировки относятся к независимо исполнимому порядку задач и нормативным контрактам.

## P1 — Draft/Published foundation требуется раньше, чем заявлено в dependency DAG

**Артефакты:** `RS-AUT-01.md:49` требует отдельный неисполняемый draft; `RS-AUT-03.md:29,51` требует publishedRevision и publish; создание Draft/PublishedRevision выделено в `RS-AUT-05.md:46,50`. Но `product.json:152–158` делает AUT05 зависимым от AUT01–04. Ранние пакеты зависят от результата позднего.

**Source:** `packages/shared/src/automations/graph.ts:1–7` (`compileAutomationGraph` contract) — нынешний граф компилируется в действующую конфигурацию matchers/actions; `apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx:96–110` (`save`) вызывает compiler и onSave. `packages/shared/src/automations/automation-system.ts:99–115` (`AutomationSystem.constructor`) создаёт обработчики и запускает scheduler при enableScheduler; `:383–408` (`startScheduler`, `stopScheduler`) — реальная текущая точка переключения.

**Исправление перед передачей агентам:** назначить foundational Draft/PublishedRevision schema, gateway saveDraft и переход старого writer/scheduler одному раннему owner — AUT01; AUT03 зависит от этого foundation. AUT05 остаётся владельцем tutorial/compare/publish UX. Не добавлять обратную AUT01→AUT05 связь: это создаст цикл. Явно определить workspace ownership epoch/fence, остановку прежнего Scheduler/handlers и регистрацию новых subscriptions; одновременно активен только один путь effects. Shadow-проверка миграции не совершает внешних операций.

**Независимые проверки:** saveDraft не меняет активную конфигурацию и не запускает scheduler; одновременно открытые старый и новый клиенты не создают два effect intents; переход legacy-enabled matcher сохраняет расписание и семантику, stale legacy writer отклонён. Нынешние metadata decision/group/annotation (`graph.ts:216–218`, `isFlowNode`) остаются неисполняемыми при миграции, пока пользователь явно не преобразует их в runtime v2 condition. Fixture старого графа с decision metadata и двумя действиями должен сохранить оба действия; мутант, автоматически включающий branching, обязан быть отклонён.

## P2 — Document требуется однозначно связать с существующим page kind

**Артефакты:** `RS-SHEET-01.md:48` задаёт Document format=sheet; `RS-FORM-01.md:46` — Document representation; Slides использует ту же новую семантику. `packages/core/src/rox2/platform-contract.ts:17–41` (`ROX2_ENTITY_KINDS`) содержит `page`, но не `document`.

**Исправление:** выбрать нормативно один вариант: существующий `EntityRef.type=page` с versioned representation format/payload, либо один новый зарегистрированный document kind с явной page/document migration и alias lookup. Выбор должен быть общей зависимостью Sheets/Slides/Forms, а не локальным решением каждого агента. Metadata, grants, search IDs и links хранятся под одним canonical ID; representation payload не создаёт второй authority.

**Проверки:** одна ссылка открывает одну сущность после reload; same ID возвращается поиском, mentions, Share и MCP; смена renderer/format не создаёт вторую запись. Это неоднозначность target contract, не доказательство существующего дубликата.

## P2 — Sheets CRDT cells / CAS structure требует общего адресного контракта

**Артефакт:** `RS-SHEET-01.md:52` назначает CRDT для cell edits и CAS для структуры; `:32` обещает стабильные Workbook/Sheet/Cell IDs. Сейчас не определено поведение offline cell operation после удаления/перестановки строки, столбца или листа.

**Исправление:** cells адресовать стабильными sheetId/rowId/columnId; A1 является вычисляемым отображением. Структурные операции передают structureRevision; cell operation сохраняет структурный контекст. Указать tombstone/rebase/rejected_orphan policy, формульные ссылки по identity и восстановление отклонённого draft. Нельзя применять устаревшую A1-позицию к новому содержимому после reconnect.

**Проверки:** A offline редактирует B2; B вставляет/удаляет строку и перемещает лист; reconnect не меняет другую логическую клетку. Удалённая цель даёт явное восстановление draft; formula reference получает нормативный #REF. Эти проверки нового slice, не утверждение о нынешней реализации spreadsheet.

## P2 — Effective Money содержит устаревшее определение, хотя inline revenue корректно

**Артефакт:** `resolved-operation-contracts.json:112–126` сохраняет `$defs.Money={currency,minorUnits:integer}` внутри effectivePayloadSchema. Inline revenue `:30–55` и форма DF02 `:2129–2148` нормативно используют `{amountMinor:decimal-string,currency}|null`, диапазон BIGINT и запрет float.

**Исправление:** в эффективном schema заменить Money на точное string определение либо удалить неиспользуемый historical `$defs.Money`; старую схему сохранять только в историческом источнике. Typed result `revenue:Money|null` должен ссылаться на нормативный тип. Центральная компиляция проверяет определения, ссылки и result binding, а не только inline payload fixtures.

**Проверки:** корректное amountMinor string проходит; minorUnits integer и IEEE Number отвергаются; null сохраняет «не указано», а '0' — нулевую сумму; верхняя граница BIGINT проходит, следующий integer string отклоняется семантической валидацией. Нынешний inline revenue не принимает старую форму — это замечание к согласованности effective schema, а не обнаруженный bypass.

## Что проверено и не требует новой блокировки

- RS-FOCUS-01 корректно сохраняет локальный TaskTrackerWidget/createPersonalTask, явно требует измерения реального Electron cascade, IME, keyboard focus и high-contrast. SHA screenshot binary не выдуман. Глобальный запрет focus не предлагается. Source: widgets.tsx:1125–1196; styles/index.css:327–351,476–481.
- RS-BASE-01:46–50 явно различает новый зарегистрированный CustomRecord и проекции существующих Tasks/CRM; Notes Base не объявлен готовым spreadsheet/backend. Оснований заявлять уже созданную вторую CRM authority нет.
- Все новые backend modules обозначены PROPOSED в `apps/workspace-service`; отдельный per-surface identity/ACL engine не задан. Значения исполнения и verification разграничены. Предлагаемые endpoint имена не выдаются за существующие.
- Generator использует синтетические данные и SHA source citations. Скриншоты с частными данными не включены в public bodies. Product/runtime readiness остаётся NOT_RUN.

## Итог

Перед параллельной реализацией требуется устранить P1 порядок foundation/cutover и зафиксировать три P2 контракта. После этого задачи могут публиковаться как предложения реализации; этот review не является proof существующей функциональности или успешного продуктового E2E.

## Повторная проверка исправлений — 2026-09-30

Все четыре замечания RESOLVED на уровне спецификаций. Предыдущие замечания выше сохраняются как история review, а не как текущие блокировки.

- P1: AUT01:45,49 владеет Draft/PublishedRevision, минимальным publish и переключением legacy writer/scheduler с fence. AUT05:46 переиспользует foundation. Draft не пишет runtime config, disabled matchers не включаются автоматически, новые executable nodes требуют AUT03.
- P2 identity: Sheets:48, Slides:46, Forms:46 используют canonical kind=page/contentKind. Document — интерфейс содержимого, PageKind/CSP отдельно; IDs/grants остаются каноническими.
- P2 Sheets: Sheets:52 определяет стабильные identities, structureVersion, rebase, tombstones и восстановление; :79 добавляет проверку удаления цели offline edit.
- P2 Money: эффективные определения используют amountMinor:string/currency; result binding явный. Историческое упоминание minorUnits не является допустимым полем.

Независимые структурные assertions: 7/7 PASS. JSON parse PASS; рекурсивно проверено определений Money: 1. Lead сообщил о реальной Ajv/Draft07 компиляции и 30 fixtures PASS; этот review не выдаёт чужой запуск за независимый. Product/runtime/Electron/provider E2E: NOT_RUN.

### SHA-256 проверенных артефактов

| Артефакт | SHA-256 |
|---|---|
| `scripts/rox-suite/build-product-drafts.mjs` | `1e0365ffc9eb438de466e05521f17583e675ebd5c4bb8e0b9d7451f6125d4d38` |
| `docs/rox-suite/issue-drafts/product/RS-AUT-01.md` | `0cce25fa735678a40567fd20717d78374d7babd9908fde0fe37429c14932cb5b` |
| `docs/rox-suite/issue-drafts/product/RS-AUT-02.md` | `365493872cebf01d6f89fc91e6978e9f81101b14537fe6c86e8af249b34a140f` |
| `docs/rox-suite/issue-drafts/product/RS-AUT-03.md` | `c97343c804a36db1815e89f70478a5277b69bcd564332c8e2cba4a5ff9e4921d` |
| `docs/rox-suite/issue-drafts/product/RS-AUT-04.md` | `64546597efd261549699f3cc7ab9ca0ac7d9d8c661a19235308319fda71e690d` |
| `docs/rox-suite/issue-drafts/product/RS-AUT-05.md` | `66ec965dacd9933e56dfc345456851afac61fac6e3451ee5a0e9c44f07686eaf` |
| `docs/rox-suite/issue-drafts/product/RS-BASE-01.md` | `d376aa907b0c623372b79883a0d47cf7ccdf704bc607b6f66611640775683fbb` |
| `docs/rox-suite/issue-drafts/product/RS-FOCUS-01.md` | `0ab5d7f3f74118b836e20b58461a291b22c70ac365eac9a28a89ae130b8798b7` |
| `docs/rox-suite/issue-drafts/product/RS-FORM-01.md` | `cf3c32a1e7c4d84a232894acc7403dbe47aadbb58c5ad0af75f9e01fcf212159` |
| `docs/rox-suite/issue-drafts/product/RS-SHEET-01.md` | `8909c1fcbcffd39e0428768735dad12953e5cd98a20eb294821bb5c8dd35c2cf` |
| `docs/rox-suite/issue-drafts/product/RS-SLIDE-01.md` | `b02ce0ac6affbe8733b6eb038c0aff4294af16d0210fa540d6371c8b0f02a9f3` |
| `docs/rox-suite/issue-drafts/product/product.json` | `b89c55767bbe006b5446cb3ee5fed67780fe1e5b1f1f08b46a10288c30839938` |
| `plans/macro-integration/resolved-operation-contracts.json` | `c98c9a256ee234dee27e43ae73c22702a079b6dbd82a93fa105ea0e6ff69ef15` |
