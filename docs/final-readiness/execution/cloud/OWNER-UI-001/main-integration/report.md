# UI-001: восстановление внешних ссылок и доставка в main

Вход: `635fc495d02c3fe1380740444cb90cf4fbdb58d9`; исходный task input `76228cc33e44518e5fab5e59f5c754f4051d1e8c` сохранён в корневом результате. Полномочия расширены пользователем до полного ремонта исходников, GitHub и merge main. Чужие рабочие копии и предыдущий delivery сохранены.

Неизвестные/повреждённые ссылки раньше открывали чаты, теряли адрес или вызывали URIError. Runtime resolver теперь сохраняет исходный адрес и возвращает отдельное unavailable-состояние. NavigationProvider, panel stack/slot, compact view и layout snapshot используют это состояние. Pending replay сохраняет query и options; URL restore не выполняет action.

Проверены реальные parser, Jotai atoms, NavigationProvider, callbacks, URL/history и MainContentPanel в Chromium с заменёнными leaf UI и electronAPI fixture. Перезагрузка, multi-panel, назад/вперёд, workspace, malformed, latest-pending и сохранённые action-адреса включены. Negative control с исходным NavigationProvider воспроизводит неправильный fallback.

Маршрутная регрессия: 221/0, 733 assertions. Shell/layout/native-owner unit regression: 338/0, 1454 assertions, 27 явных browser skips. Отдельный Chromium navigation: 8/0, 121 assertions. Electron typecheck и locale parity/sort/coverage прошли. Renderer build прошёл. Итоговый совместный прогон navigation/resource/layout Chromium: 16/0, 138 assertions. Native ownership renderer fixtures: 5/0, 9 assertions. Полный CI graph завершается отдельно; final GitHub receipt следует после PR/merge.

Исправлены устаревшие проверки уже принятого main: добавлены две существующие RPC строки в точный snapshot; native visibility wiring учитывает общий bounds hook; inspector сохраняет скрытый/inert draft через RetainedSurface. Поведение native bridge проверяется существующими fixtures и owner/DOM unit tests. Старые падения/таймауты сохранены в отдельных логах, а не заменены итоговым PASS.

Source manifest и result.json содержат точные файлы, runtime и команды. Исходный acceptance-contract.json остаётся без изменений. Win10/11 installed, macOS installed Retina, actual hosted product и canonical backend readback не заменяются этими fixtures. `fullDoDClosed:false`.


Ревью PR #1412 выявило два воспроизводимых дефекта исходного продолжения: сохранение explicit session route до завершения workspace validation и потерю неизвестных суффиксов на других известных префиксах. Оба исправлены. Отрицательный прогон расширенной матрицы: 9 pass / 27 fail; после исправления: 232 pass / 0 fail / 912 assertions. Реальные NavigationProvider callbacks в Chromium: 9 pass / 0 fail / 148 assertions, включая nonexistent/cross-workspace sessions, legacy settings aliases, reload, history и deferred navigation.

Actions нового workflow закреплены точными SHA, проверенными через GitHub git/ref API. Общий validate:ci первоначально остановился на пяти migration integration tests по лимиту 5 секунд. Без изменения ожиданий тестов бюджет этой команды увеличен до 30 секунд: отдельный повтор 109 pass / 0 fail / 291 assertions. Полный повтор записывается отдельно. Нестабильное завершение тестового browser fixture (все 9 behavior cases уже pass, afterAll timeout) сохранено в 32-review-browser-green.log; диагностический и чистый повтор завершились без ошибок. Нативная и hosted-product приёмка остаются внешними предпосылками.

Полный повтор `bun run validate:ci` завершился с exit 0: весь typecheck graph, shared/config/connection tests, 19 document-tool smoke tests, i18n parity/sorted/coverage. История пяти исходных timeout сохранена.
