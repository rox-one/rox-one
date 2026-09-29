# Macro → ROX: спецификация архитектурного исследования

## Revision 3: повторная проверка, конкретный продукт и cloud delivery pack

Дополнительный user intent: подробно определить каждый экран, размещение внутри существующего ROX, функциональность, inputs/outputs, UI/UX/hover/focus/keyboard, PRD/spec/expected results/DoD/plans для будущего cloud execution.

Observable acceptance:50 current source screens and61target screens;219concrete controls; typed command/query/error contracts and exact user scenarios; source HEAD delta recheck308evidence refs;52per-WPcloud packets with immutableinputSHA/specDigest/ownership/dependencies/UI scope; schemas/gates rejecting forged/stale/fixture/incomplete receipts; independent review+corrections; actual artifact checks+commit/push/readback. Feature implementation/provider/native E2Es не являются scope этой подготовки.

Нормативные документы: `docs/macro-integration/product/PRD.md`, `UI-UX-CONTRACT.md`, leaf screen docs/JSON; `cloud/macro-integration/AGENTS.md`, SPEC/PLAN/EXPECTED-RESULTS and52packets. Historical Revision2 research retained below.

Цель: дать coding agents воспроизводимый план развития существующих ROX surfaces до единого collaborative workspace. Исследование включает продукт, фактические backend paths, persistence, collaboration, authorization, search, agents, cloud dependencies и licensing обоих baseline SHA, зафиксированных в `docs/macro-integration/README.md`.

Acceptance: 24 запрошенных тематических документа; 4 обязательных JSON; 30+ пакетов с зависимостями, точками изменения и проверяемыми сценариями; Macro/ROX/target ERD; 10 обязательных Mermaid diagrams; четыре collaboration sequences; лицензии с отдельными условиями; critical review и Revision 2; evidence с валидными paths/symbols/строками; ациклический implementation DAG; точное разграничение наблюдений и предложений.

Основные ограничения: сохранять native ROX Pages/Tasks/Projects/Meetings/Sessions, React/Electron и рабочие локальные pipeline; не считать agent session human channel; не строить второй entity universe рядом с Rox2EntityRef; не копировать AGPL или спорно лицензированные файлы без разрешения; не объявлять UI макет реализованной функцией; не заявлять прохождение runtime E2E без исполнения.

Метод: source snapshot → independent domain audits → implementation graph → capability inventory → выбор архитектуры → independent adversarial review → Revision 2 → механическая проверка артефактов → commit/push документации. Вывод о неизвестной функции допускает NOT_ESTABLISHED с указанием проверенной области; не превращать отсутствие одного grep match в доказательство отсутствия продукта.

Артефакт является планом реализации, а не реализацией всех перечисленных возможностей. Пользователь запросил архитектуру переноса и work packages.
