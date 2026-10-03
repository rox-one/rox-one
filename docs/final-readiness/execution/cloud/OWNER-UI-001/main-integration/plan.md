# План UI-001 интеграции

1. Владелец: текущий агент. Зафиксировать main и GitHub, сохранить другие рабочие копии; read-only scout и .codegraph gap. Выполнено.
2. Владелец: текущий агент. Сохранить контракт и определить реальный дефект. Выполнено: неизвестные и malformed ссылки подменяются/отбрасываются upstream.
3. Владелец: текущий агент. Воспроизвести дефект тестами actual parser/panel/navigation callbacks, реализовать unavailable runtime resolution и lossless pending replay. Зависит от 2.
4. Владелец: текущий агент. Unit и реальный Chromium: позитивные маршруты, reload/history/workspace, malformed/unknown/actions, race/retry/layout. Затем CI graph, locales и renderer build. Зависит от 3. Хранить исходные ошибки и последующие результаты отдельно.
5. Владелец: текущий агент. Обзор полного diff, точный commit/push, PR, CI/review readback, исправления, merge main и remote readback. Зависит от 4; пользователь уже разрешил доставку.
6. Владелец: текущий агент. Обновить результат и outputs с точными SHA, PR/merge и остаточной платформенной матрицей. Зависит от 5.

Не запускать дополнительных работников: исходный single-writer запрет делегирования сохраняется. Главный агент самостоятельно отвечает за интеграцию.

Продолжение после третьего ревью: проверить empty panels fallback и actual desktop service callback; воспроизвести CI source 01723bb2; выполнить общий regression/typegraph; закрыть подтверждённое замечание; устранить только exact-host DIRTY currency при необходимости; слить PR 1412 и записать main receipt с readback.
