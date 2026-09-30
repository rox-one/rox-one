# Независимая проверка публикации ROX Suite

## Область и результат

Проверка выполнена 2026-09-30. **PASS для подготовленных issue bodies, графа зависимостей и изолированных сценариев publisher.** Рабочее приложение, cloud executor и функциональность новых surfaces этой проверкой не запускались. Реальное создание GitHub issues и remote readback выполняет lead; их результат следует брать из `plans/rox-suite/publication.json`, а не из этого отчёта.

Source baseline: repository `rox-one/rox-one`, commit `249b3b44220bcfbd7d467de9cfc18f76e1c37807`.

Checked publisher: `scripts/rox-suite/issues.mjs`, final SHA-256 `2a709985a9b725a1c09706dc549a3ca6244335f21b2fd0b1f2972147d51f9c2c`. Это hash проверенных локальных байтов, а не утверждение, что script уже содержится в source baseline. Первоначальный PASS на `2d43fd29549d9965620a31a695359f1ee25e8872a26b5e457593ebe4b3bf3e62` сохранён как historical attempt; после privacy cleanup все 11 checks повторены на final bytes и прошли.

Evaluator запускал те же байты через Node VM. Filesystem mutations и `gh` были заменены in-memory adapters; `git show SHA:path` читал настоящий repository. **Ноль GitHub network calls и ноль изменений shared artifacts со стороны evaluator.** Идентификаторы `#9000…` использовались только в синтетических remote fixtures и не являются опубликованными issue numbers.

## Проверенные входы

| Объект | Наблюдение |
|---|---|
| Manifests | Product 10, Meetings 5, Collaboration 7, Services 8: всего 30 |
| Requirement IDs | 30 уникальных; все `dependsOn` и `relatedRequirementIds` разрешаются |
| Dependency graph | Ацикличный; soft related links не превращены в prerequisites |
| Source references | 136 immutable GitHub blob links; 66 различных `SHA:path` blobs существуют |
| Source ranges | Все проверенные начало/конец строк находятся внутри реального blob; один source SHA |
| Services | 8 issue bodies, 34 source refs; 8 Mermaid diagrams parse PASS |
| Mermaid negative control | Broken grammar отклонена parser, green baseline сохранён |
| Private artifacts | В bodies не обнаружены clipboard filenames, screenshot image URLs, private-key markers или известные private screenshot identifiers |
| Delivery statements | Bodies описывают implementation requirements; README template прямо отделяет issue publication от UI implementation/cloud launch |

Ссылки проверены чтением исходников. Source validation не доказывает наличие работающего backend, корректность каждого proposed endpoint или готовность продукта.

## Поведенческие checks publisher

| Check | Expected / observed |
|---|---|
| Collect текущих 30 drafts | 30 items, нет GitHub calls — PASS |
| Fresh publication | 30 отдельных `issue create`, каждый с `--body-file`, статус только `IN_PROGRESS` — PASS |
| Remote title recovery | Найденные 30 synthetic RS IDs используются повторно; 0 creates — PASS |
| Partial receipt resume | Receipt с 10 IDs + 30 existing remote fixtures восстанавливает 20 IDs; 0 creates — PASS |
| Dependency and soft links | Все hard/soft RS refs превращены в numerical GitHub URLs; отсутствует `/issues/RS-…` — PASS |
| Full readback | 30 `issue view`; body/state/url/RS marker совпадают; terminal verified только после всех checks — PASS |
| Readback mismatch | Seeded body mismatch отклонён; ранее verified receipt уже downgraded в `IN_PROGRESS` — PASS |
| Duplicate remote ID | Два title matches для одного RS ID отклонены до create — PASS |
| Foreign receipt repository | Отклонён до GitHub calls — PASS |
| Unknown prerequisite | Отклонён до output writes — PASS |
| Private screenshot marker | Отклонён до GitHub calls; error не повторяет marker value — PASS |
| RS ID в numeric `relatedIssues` | Отклонён до output writes — PASS |

Последний isolated evaluator run после privacy cleanup: **11 сценариев PASS** на final SHA-256 выше. Строки таблицы hard/soft links и full readback входят в один combined сценарий. Six seeded failures — readback mismatch, duplicate ID, foreign repository, unknown dependency, private marker, invalid numeric related issue — дают ожидаемый отказ. Baseline collect/publish/recovery/readback зелёные. Ошибки инфраструктуры не учитывались как caught mutations.

## Source-backed safety seams

| Local publisher seam | Проверенный контракт |
|---|---|
| `call`, line 6 | `execFileSync('gh', args)`: аргументы передаются отдельно; shell interpolation отсутствует |
| `collect`, lines 8–9 | Nested manifest path + fallback для root `collaboration.json`/`services.json` |
| `validate`, lines 10–11 | Immutable source blobs/ranges, mandatory detail sections, known dependencies и DAG; private marker denial |
| `linkBody`, line 12 | Hard requirements и soft RS references получают URL из receipt; existing issue refs остаются numerical |
| Additional validation, line 14 | Numeric positive integer existing issues и known soft requirements |
| Receipt guards, lines 17–19 | Repository/ID/URL consistency; bundle digest; предыдущий verified status сбрасывается до mutations |
| `publish`, line 21 | `--body-file`, persistent receipt после каждого recovered/created ID, duplicate title rejection |
| `link-and-verify`, line 22 | Exact remote body/state/url/ID readback; terminal verified только после complete loop |

Названные строки относятся к указанному SHA-256 publisher. Source baseline для product claims закреплён независимо; новый tooling не выдаётся за существующий feature mechanism.

## Findings и устранение

1. **Закрыто:** nested-only lookup пропускал два root manifests. Добавлен fallback.
2. **Закрыто:** `relatedRequirementIds` не попадали в rendered body. Добавлены numerical remote links и проверка IDs; `relatedIssues` теперь strictly numerical.
3. **Закрыто:** повторный link-and-verify мог сохранить старый verified status после partial failure. Перед edit сохраняются `IN_PROGRESS`, текущий bundle digest и previous verified digest; seeded mismatch проверен.
4. **Закрыто:** отсутствовала receipt repository/unique ID consistency. Guards проверены foreign-repository negative control.
5. **Закрыто:** AUT04 ссылался на `AutomationTestPanel.tsx:1–75`, реальный blob имеет 64 строки; AUT05 на `default-seeds.ts:509–555`, blob имеет 554. Текущие ranges исправлены; strict independent pass 136 links без ошибок. Validator теперь исключает trailing newline из line count.
6. **Закрыто:** HD01 form intake мог реализовать второй renderer без Forms dependency. Текущий manifest требует `RS-FORM-01`; combined DAG остаётся ацикличным.
7. **Закрыто до public Git push:** в первоначальном publisher guard были literal identifiers из private screenshots, хотя они отсутствовали в issue bodies. Final guard использует только общие patterns: clipboard filenames, inline image payloads, admin-console URLs и private-key headers. Publication flow не менялся; private-marker negative control остаётся PASS и не отражает marker value в error.

## Privacy и receipt readback после cleanup

После cleanup проверен local receipt: `PUBLISHED_AND_READBACK_VERIFIED`, 30 issues, `privateImagesPublished=false`. SHA-256 всех 30 local `publishedBodyFile` совпадает с `publishedBodySha256` в receipt. Реальный GitHub readback уже выполнен lead; evaluator не делал дополнительный remote вызов. Private screenshots и их source organization identifiers не были загружены через этот issue publication bundle; issue bodies не содержат исходных private IDs, images не прикладывались. Initial literal guard был удалён до публичной доставки tooling. Эта проверка ограничена данным bundle и не заявляет аудит всей ранее существовавшей истории GitHub или других внешних каналов.

## Практические ограничения

- Publisher — resumable serial script с одним writer. Он не является distributed scheduler; два concurrent publish processes не запускать. Межпроцессный lease не реализован и не заявлен.
- Recovery без receipt ищет marker среди максимум 1000 GitHub issues. Для текущего bounded набора достаточно; перед использованием в существенно большем repository добавить pagination/exact search. Никакая exactly-once remote creation гарантия не заявлена.
- Private marker scan ловит известные screenshot identifiers, а не произвольные secrets. Screenshots не прикладываются и не загружаются; контролируемые bodies используют synthetic data. Matcher не заменяет проверку содержимого.
- Exact readback проверяет body bytes и существование issue. Он не доказывает качество или реализацию feature, correctness paid provider, native runtime/font либо выполнение E2E.
- 30 RS requirements остаются отдельной proposed программой. Старый Macro 52-WP manifest не получает новые scopes автоматически; перед cloud coding нужны отдельные task contracts/ownership/proof lanes.

На проверенных bytes и текущих 30 manifests surviving publication blocker не обнаружен. Доставка завершена только после реального remote readback и фиксации соответствующего receipt lead.
