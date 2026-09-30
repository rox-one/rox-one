# Delivery: новые требования ROX Suite и Revision 4

## Подтверждённый результат

30 новых issues [#1091–#1120](https://github.com/rox-one/rox-one/issues?q=is%3Aissue+%22%5BROX+Suite%5D%22) созданы; фактические URLs каждого находятся в README и publication.json. Все OPEN. Каждое тело прочитано через GitHub API и сравнилось с точными локальными байтами после добавления dependency links. Private screenshots не загружались.

## Planning verification

| Проверка | Результат |
|---|---|
| Issue source references | 136 immutable references / 66 blobs, paths и ranges PASS |
| Task DAG | 30 unique IDs; hard/soft links разрешаются; cycle нет |
| Publisher independent evaluator | 11 cases PASS; synthetic gh, ноль network effects reviewer |
| Product architecture review | P1 Draft/Published ordering и 3 P2 contracts исправлены; independent 7 assertions PASS |
| Macro/ROX HEAD final probe | Macro767a999, ROXmainf63294b; source pinned249 docs revision has identical apps/packages |
| Control handoff + cloud gates | 15 tests PASS, включая corruption/denied/stale/hash/path/fixture/ancestry controls |
| Form schemas | 18 variants +17 effective schemas compiled; 30 shape/BigInt cases PASS |
| Executor contract | 5 schemas,19 fixture cases,3 mutation sensitivity checks,8 source refs PASS |

Статус всех product features: **PLANNED_NOT_IMPLEMENTED**. Product/browser/native/provider E2E не выполнялись для новых surfaces; сформулированные сценарии являются будущими DoD. Cloud launch **NOT_LAUNCHED**. Planning/receipt checks не создают работающий backend.

## Выявленные ошибки и исправления

1. Handoff первоначально пропускал identity/root-selector/owners/proof mutations: добавлены пять invariant checks и отрицательные controls.
2. Wrapper names ошибочно назывались canonical: разрешены в один dispatcher; wrappers выделены отдельно.
3. CLI fixture не копировал новый imported handoff module: исходный infrastructure failure сохранён как failed attempt; fixture исправлен, 15 тестов зелёные.
4. Старый временный validation dependency directory отсутствовал: использован фактически существующий isolated tool directory, default исправлен. Это ошибка среды, не product test fail.
5. AUT draft layer был поздним prerequisite; foundation перенесён в AUT01 с explicit writer/scheduler cutover. Historical decisions inert до verified v2 runtime.
6. Document format ref неоднозначен: Docs/Sheets/Slides/Forms bound to canonical page/contentKind; Sheet row/col/cell IDs, structureVersion/tombstones/rebase явно определены.
7. Historical Money $defs конфликтовали с новым inline revenue: effective defs/result binding нормализованы; первичные исторические schemas сохранены.
8. Publisher повторный edit мог оставить старое verified claim: до mutation сохраняется IN_PROGRESS/current bundle digest; mismatch negative отклонён.
9. Две source ranges были длиннее blobs: исправлены. Help Desk public form intake связан с общим Forms requirement.

## Improvements workflow

Task-specific safeguards внедрены в validators/publisher и проверены. Изменение глобальных prompts/skills не предлагается: существующие operator instructions уже требуют независимого review, наблюдаемого результата и exact readback; поддержанного улучшения формулировки за рамками этих инструментов не обнаружено. Codex memory не изменялась.

## Delivery boundaries

Документация идёт в `docs/macro-integration-20260930`; main и приложения не изменяются. Исходные пользовательские CSS правки в отдельном `/Users/t/Projects/rox-one` сохранены. 52 Macro WP packets и 30 RS requirements — разные scopes; будущий scheduler обязан сформировать RS typed packets/leases/lanes до dispatch.
