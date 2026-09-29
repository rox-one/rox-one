# Macro → ROX: навигация и доказательства

## Detailed product / cloud pack — Revision 3

Новый вход: [PRD](product/PRD.md), [UI/UX](product/UI-UX-CONTRACT.md), [50 current ROX screens](product/rox-screen-audit.md), [19 collaboration screens](product/collaboration-screens.md), [24 domain screens](product/domain-screens.md), [18 shared screens](product/shared-screens.md), [cloud execution pack](../../cloud/macro-integration/README.md).

61 target screens /219controls;52 individual cloud packets with full domain contracts and UI stage scope, expected results/DoD/proof schema, dependency/ownership/toolchain gates. Target screens remain PROPOSED. [Повторная проверка](24-reverification-and-product-spec.md) фиксирует Macro `5678f9bd777413f66e8bddac58f13f21150d831b`, ROX main unchangedf632, study inpute780.308original source refs rechecked:304identical/4reviewed deltas. Cloud jobs NOT_LAUNCHED; runtime feature tests future gates.

Следующая секция сохраняет первоначальный baseline исследования; per-file citations не переписываются на новые SHA без проверки.

Архитектурное исследование текущего кода, 2026-09-30. База Macro: `c966b79d40798c6c726a3b15fe90517941fc6e61`; база ROX: `f63294ba4fffa7238b46b24e918925a313ad0b12`. Это фиксированный baseline, а не заявление о состоянии последующих HEAD.

Начать с [executive summary](00-executive-summary.md), затем [Revision 2 архитектуры](19-target-architecture.md), [плана](21-implementation-plan.md) и [тестового контракта](22-test-plan.md). Машинный план находится в `plans/macro-integration/`.

Статусы: **OBSERVED_CODE** — прочитан исполняемый путь; **INTENDED_DOC** — только продуктовая документация; **PROPOSED** — целевое решение; **UNVERIFIED_RUNTIME** — код есть, развернутый сценарий не запускался; **NOT_ESTABLISHED** — поддержки не доказано. Название каталога, enum, generated schema и mock не доказывают работающий capability.

Все ссылки на исходники используют SHA baseline. Evidence JSON содержит repository, sha, path, symbol и строки; номера строк относятся только к указанной ревизии. Составной вывод обоснован несколькими записями. Планы новых файлов всегда помечены как proposed; существующие точки изменения проверяются валидатором.

Доставка этого задания — исследование и implementation-ready план. Пользовательские E2E описаны как будущие gates; их результаты нельзя объявлять пройденными по итогам статического аудита. Нет переноса исходного кода Macro и нет изменения production данных.

## Что передать coding agent

1. Прочитать 00, 19 Revision 2 и выбранный domain audit.
2. Выбрать ready пакет из `dependency-dag.json::topologicalOrder`, проверив accepted prerequisite artifacts. `work-packages.json` — полный contract пакета, а не только title.
3. Сохранить один writer на shared file area. Existing code baseline и proposed paths различаются явно; не создавать второй entity/notification/user universe.
4. Пройти relevant gates из 22, включая seeded failure controls, и приложить implementation SHA/deploy digest/receipts. Архитектурная валидация не заменяет feature tests.

Результат: 38 surface families, 162 capability rows, 38 entity mappings, 52 work packages и 154 prerequisite edges. `validation-report.json` содержит source/schema/link/diagram checks и hashes; `validation-attempts.json` сохраняет первоначальные ошибки и исправления.

Reproducibility scripts и команды — [scripts/macro-integration/README.md](../../scripts/macro-integration/README.md). Важные source facts доступны по evidence IDs; поля frontend в central matrix — surface entry points, точные symbols/mechanism boundaries в evidenceRefs и domain audits.
