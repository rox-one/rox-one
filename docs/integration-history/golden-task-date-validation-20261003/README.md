# Golden Tasks: точная календарная дата

Из source `5def9ffd36dc160fdc7c908784e0ef97ba6a732e` восстановлена проверка `taskDateFromInput`: введённые год, месяц и день должны совпадать с результатом локального `Date`. Современная форма `TaskDetail` использует `parseDateExpression`; до исправления `2026-02-31`, `2026-13-01` и `2026-02-00` принимались как другие даты. Теперь форма остаётся открытой и не отправляет native PUT. Правильный високосный день сохраняется в существующем native task store как тот же локальный календарный день.

Исходные отрицательные проверки: core 19/1, actual Tasks DOM 1/1. После исправления: весь personal task core 67/0/161, actual current Tasks DOM 2/0; targeted controls в America/Los_Angeles и Asia/Tokyo — по 2/0/11. Полная проверка типов текущего core завершилась с кодом 0. Browser bundle и реальный stylesheet заново собраны на актуальной базе `c9f14955`.

[Точный receipt и fingerprint каждого проверенного файла](verification.json) содержит ревизию, окружение, исходные ошибки, пределы проверки и хеши журналов. Fixture использует настоящие TasksPage, TaskDetail, canonical personal-tasks frontend и scoped synthetic native CAS replies; это проверка данного поведения, а не принятие всего приложения или нативного релиза. Ветки-источники сохранены.
