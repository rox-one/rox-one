# Независимая проверка source references и delivery packets

Статус: **source readback выполнен; semantic corrections отмечены отдельно**. Это проверка архитектурных спецификаций по Git objects, а не свидетельство работающей collaborative системы. Machine report: [product-source-validation.json](../../../plans/macro-integration/product-source-validation.json).

## 1. Проверенные версии и граница доказательства

- ROX source baseline: `f63294ba4fffa7238b46b24e918925a313ad0b12`; study checkout: `e780e73ae84c977cf81546b49140d318dfcd6049`. Разница source directories `apps/electron`, `packages/ui`, `packages/core`, `packages/server-core`, `packages/shared` пуста. Ссылки на оба SHA допустимы для совпадающих blobs.
- Macro original audit: `c966b79d40798c6c726a3b15fe90517941fc6e61`; intermediate reverified HEAD: `44a2e9efa62b557c5b0378f6376db0a6c4c6a127`; current reverified HEAD: `5678f9bd777413f66e8bddac58f13f21150d831b`.
- Проверено содержимое Git objects, существование exact paths, bounds source ranges, generated cloud payload consistency и несколько claims по функциям. GitHub URL не заменяет чтение кода.
- Initial native capture attempts **NOT_VERIFIED**; later parent observed installed shell/Tasks screenshot and AX five surfaces, recorded in native-ui-observation.md. Source-pinned build, loaded font, rendered widths/focus, actual RPC/provider success and new feature E2E remain unverified.
- Linux domain/renderer/container, provider-live и feature E2E **NOT_RUN / PLANNED**. Ни current feature completeness, ни будущий DoD данным проходом не закрываются.

## 2. Реально выполненные проверки

| Проверка | Объём | Результат |
|---|---:|---|
| Source refs в shared/domain/collaboration contracts и screen-evidence | 203 occurrences / 123 distinct Git objects | Все paths существуют по указанному SHA |
| Source ranges | 203 заданных | Все находятся внутри файла |
| Shared refs без line range | 0 | Все18 shared references получили targeted ranges |
| Git source links в product Markdown (без этого report) | 203 occurrences | Все objects/ranges доступны |
| Original evidence reverification | 308 | 304 identical, 4 changed; фактические blobs совпадают с report |
| Новые screen Macro references old→new | 31 occurrences / 20 unique paths | 30 identical, layoutManager changed и покрыт explicit changedReview |
| Work-package affectedFiles | 305 occurrences | Все существуют в ROX source |
| Work-package newFiles | 382 occurrences | Все отсутствуют в исходном ROX; правильно отмечены proposed |
| Cloud packets | 52 | domainSpecification совпадает с original WP; allowedPaths = affectedFiles ∪ newFiles |
| Screen index | 61 contracts / 219 controls | IDs, WP references и control IDs согласованы |
| Старый validateMachine/loadBundle | 52 WP + DAG/entities/capabilities | errors=[] |

Числа occurrences включают повторное цитирование одного файла разными screens. Это не203 независимых проверенных behavior implementations. Контракты не называются текущими функциями только из-за того, что рядом стоит source link.

## 3. Macro HEAD и изменение внимания

Независимо повторены `git rev-parse <sha>:<path>` для обеих сторон каждого из 308 records в [reverification.json](../../../plans/macro-integration/reverification.json). Значения `originalBlob/currentBlob/status` совпали во всех records. На intermediate44a единственный changed original evidence был `IN014`; на current5678 изменены четыре evidence records, включая два references к одному layoutManager, appSplitRoutes и MarkMessageNotifications. Их explicit `changedReview` сохранён в machine report; старые assertions не представлены как автоматически доказанные unchanged blobs.

[MarkMessageNotifications](https://github.com/macro-inc/macro/blob/44a2e9efa62b557c5b0378f6376db0a6c4c6a127/apps/web/src/features/notifications/components/MarkMessageNotifications.tsx#L1-L82), `macro-inc/macro@44a2e9efa62b557c5b0378f6376db0a6c4c6a127`, теперь принимает channel-scoped `MessageNotificationSourceContext` и сбрасывает bounded retry budget при изменении sorted notification ID batch. Обработка остаётся `createEffect`; это не доказательство viewport dwell / прочтения глазами. Архитектурный вывод о необходимости отдельно задать read-cursor semantics сохраняется. На intermediate44a все31 новые Macro references были identical; current5678 повторный проход описан ниже.

Сохранение old citation при identical blob допустимо. Замена всех SHA текстовым поиском исказила бы источник исследования; новые выводы по changed file обязаны указывать новый SHA и новую семантику.

## 4. Конкретные semantic corrections

### SV-01 — Notes save не является доказанным concurrent serialized write (исправлено)

**P1; RESOLVED_SOURCE_READBACK.** COL-06 уточнён после проверки; ниже описана найденная исходная неточность. `COL-06.currentBehavior` и corresponding Markdown использовали «serialized saveNote». [saveNote](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/packages/server-core/src/handlers/rpc/notes.ts#L502-L517), `rox-one/rox-one@f63294ba4fffa7238b46b24e918925a313ad0b12`, при supplied `expectedRevision` сначала читает/сравнивает hash, затем выполняет обычный `writeFile`; атомарный compare-and-write/lock в этой функции отсутствует. [NotesPage](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/NotesPage.tsx#L875-L887) вызывает `saveNote` без expectedRevision.

Точная формулировка baseline: local Markdown save с optional revision precheck. Для общего concurrent document нужен отдельный serialized authority/CRDT persistence contract. Нельзя использовать эту citation как proof solved multi-user CAS.

### SV-02 — Inbox уже объединяет attention и mail (исправлено)

**P1; RESOLVED_SOURCE_READBACK.** SH-05 теперь сохраняет attention + mail; ниже описана найденная исходная неточность. `SH-05.currentBehavior` «Inbox remains mail» сужает текущую модель. [InboxPage / allItems / allCounts](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/InboxPage.tsx#L91-L140), `rox-one/rox-one@f63294ba4fffa7238b46b24e918925a313ad0b12`, загружает `useInboxItems({withRemote:true})`, `useMail`, объединяет attention items с unread mail и показывает decisions/messages.

Точная формулировка: сохранить существующие attention + mail views, расширить общую attention projection. Отдельные Notifications/Activity representations не должны уничтожить существующие permission/credential/plan/memory review inputs.

### SV-03 — точное имя recorder component (исправлено)

**P2; RESOLVED_SOURCE_READBACK.** `SE-MDREC` называл `RecordingControls`, которого нет в cited file. Реальное экспортируемое имя — [RecordingPanel](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx#L689-L719), `rox-one/rox-one@f63294ba4fffa7238b46b24e918925a313ad0b12`. С разрешения parent corrected symbol и exact range689–719 записаны в обоих source-audit артефактах; timer/pause/resume/stop claim подтверждён.

### SV-04 — shared source entrypoint precision (исправлено)

**P2; RESOLVED_SOURCE_READBACK.** Изначальные17 shared `existingEvidence` были без targeted ranges. Root generator исправил symbols/ranges и добавил SH-18: все18 references имеют валидные bounds. `Rox2EntityRef` type сам по себе по-прежнему не доказывает permission gateway enforcement либо готовый File UI.

## 5. Проверка чувствительности и прежнего validator

Негативные проверки применены к конкретным invariants source checker: nonexistent source path отвергнут Git object lookup; lineEnd за пределами source length отвергнут range predicate; existing `routes.ts`, названный newFile, отвергнут классификатором; WP-999 отвергнут WP registry membership. Результаты записаны в machine report. Они доказывают чувствительность этих проверок, а не чувствительность будущих product tests.

Отдельно импортированы старые `validateMachine` и `loadBundle` из `scripts/macro-integration/validate.mjs`: актуальный machine bundle дал `errors=[]`. Полный executable runner запущен и остановился до Ajv/Mermaid на:

```text
Cannot find module '/tmp/macro-rox-diagrams-20260930/node_modules/ajv/dist/2020.js'
```

Это **infrastructure attempt failure**, не fail спецификации и не текущий full-pass. Старый validator ранее проверял 104 schemas/30 diagrams; его прежний pass здесь не представлен как pass новых product docs. Не выполнялись install dependencies, генераторы и перезапись central validation-report. Помимо dependency prerequisite, старый artifact hash scan берёт все entries `scripts/macro-integration`; появившуюся `cloud/` directory следует исключить из `readFileSync` либо рекурсивно раскрыть при следующем full-run.

## 6. Что остаётся настоящими delivery gates

1. Owners фиксируют semantic corrections и сохраняют точный статус в machine report; hashes дают границу конкретного checked snapshot.
2. Native runner проверяет font network/load, focus/hover/click, narrow width/zoom, persistence/reload и failure/reconnect на реальном ROX.
3. Linux CI компилирует schema contracts, generated clients/typed routes и выполняет lane-specific domain/renderer tests; каждый новый contract регистрируется явно.
4. Provider-live gates отдельно проверяют OAuth/sync/send/Calendar/SFU/recording receipts; fixture `verified` не повышается до live verification.
5. Cloud source/digest/owner/prerequisite checks остаются обязательными; существование packet — подготовленная работа, не выполняющийся worker и не completed feature.

## 7. Дополнительный scoped validation и история delivery gates

После исходного missing-dependency attempt parent разрешил установить изолированные зависимости в `/tmp/rox-product-validation-20260930`. Независимый runner импортировал Ajv8.17.1, ajv-formats3.0.1, Mermaid11.12.0, jsdom26.1.0: текущие 104 WP schemas и 36 Mermaid diagrams во всём recursive `docs/macro-integration` и `cloud/macro-integration` прошли; errors=[]. Отдельно проверен новый completion receipt schema своим declared draft. Три seeded negative controls отвергнуты: missing schema definition, invalid primitive, broken Mermaid grammar. Центральный script/report не перезаписан; этот pass относится к указанному planning scope.

**SV-05 P1; RESOLVED_ACTUAL_RERUN.** Первый `node --test scripts/macro-integration/cloud/gates.test.mjs` реально дал3pass/4fail во время owner updates: valid receipt fixture не содержал новых mandatory negative-control assertion/exit/log/hash fields; preflight good fixture не содержал cpus/platform. Первый `bun scripts/macro-integration/cloud/cli.mjs validate` завершился exit1: `manifest.specInputs` ещё отсутствовал до generator rebuild. Эти попытки сохранены с hashes, а не отброшены.

После owner synchronization независимо повторены оба запуска: **10/10 cloud gate tests PASSED**, **CLI planning integrity52packets/60screens/216controls PASSED**. Это исправленный delivery guard, не выполненная feature migration. Native capture после disk recovery также не дал пригодного screenshot; runtime статус остаётся NOT_VERIFIED.

## 8. Current5678 reminder extension и последний bounded pass

Новый SH-18 открывает Reminder через существующие Tasks/Inbox references; это proposed contextual representation, без нового rail destination. Reminder kind уже присутствует в `Rox2EntityRef` vocabulary; store timestamp не объявлен готовым общим reminder lifecycle. Новый Macro delta и navigation readiness рассмотрены lead отдельно; independent object comparison подтвердил все308 statuses и31 screen Macro paths. `layoutManager.ts` — единственный changed path среди этих31 occurrences; current changedReview явно описывает navigator readiness/version gate.

Изолированный current runner: **107 JSON schemas PASSED** =104 WP schemas + completion draft07 +2 отдельно compiled draft07 nodes `taskSourceTransfer.requestSchemaExtension.sourceTransfer` и `body` из `plans/macro-integration/cloud/contract-amendments.json`. **36 diagrams PASSED**,3 seeded schema/grammar controls rejected. Canonical transfer amendments имеют declared precedence; старый human-readable inputUnion не принимается как отдельный competing dispatcher.

Во время финальных owner edits CLI ещё один раз корректно отверг stale domain-screen input digest; этот attempt сохранён. Итоговый final CLI результат фиксируется machine report после generator rebuild. Новые границы scope не превращают runtime lanes в выполненные: NativeUI/provider/Linux feature verification остаются будущими gates.

## Final parent runtime observation amendment

После независимого source review lead получил пригодные shell/Tasks screenshots и AX navigation Tasks/Meetings/Dossier/Pages/Inbox; см. [native observation](native-ui-observation.md). Предыдущие NOT_VERIFIED capture attempts выше остаются историей попыток. Final status: installed UI observed; source-pinned native feature E2E/font/hover/provider behavior NOT_VERIFIED. Этот amendment не расширяет независимый source/schema review до runtime certification.
