# UI-001: восстановление внешних ссылок и доставка в main

Вход: `635fc495d02c3fe1380740444cb90cf4fbdb58d9`; исходный task input `76228cc33e44518e5fab5e59f5c754f4051d1e8c` сохранён в корневом результате. Полномочия расширены пользователем до полного ремонта исходников, GitHub и merge main. Чужие рабочие копии и предыдущий delivery сохранены.

Неизвестные/повреждённые ссылки раньше открывали чаты, теряли адрес или вызывали URIError. Runtime resolver теперь сохраняет исходный адрес и возвращает отдельное unavailable-состояние. NavigationProvider, panel stack/slot, compact view и layout snapshot используют это состояние. Pending replay сохраняет query и options; URL restore не выполняет action.

Проверены реальные parser, Jotai atoms, NavigationProvider, callbacks, URL/history и MainContentPanel в Chromium с заменёнными leaf UI и electronAPI fixture. Перезагрузка, multi-panel, назад/вперёд, workspace, malformed, latest-pending и сохранённые action-адреса включены. Negative control с исходным NavigationProvider воспроизводит неправильный fallback.

Маршрутная регрессия: 221/0, 733 assertions. Shell/layout/native-owner unit regression: 338/0, 1454 assertions, 27 явных browser skips. Отдельный Chromium navigation: 8/0, 121 assertions. Electron typecheck и locale parity/sort/coverage прошли. Renderer build прошёл. Итоговый совместный прогон navigation/resource/layout Chromium: 16/0, 138 assertions. Native ownership renderer fixtures: 5/0, 9 assertions. Полный CI graph завершается отдельно; final GitHub receipt следует после PR/merge.

Исправлены устаревшие проверки уже принятого main: добавлены две существующие RPC строки в точный snapshot; native visibility wiring учитывает общий bounds hook; inspector сохраняет скрытый/inert draft через RetainedSurface. Поведение native bridge проверяется существующими fixtures и owner/DOM unit tests. Старые падения/таймауты сохранены в отдельных логах, а не заменены итоговым PASS.

Source manifest и result.json содержат точные файлы, runtime и команды. Исходный acceptance-contract.json остаётся без изменений. Win10/11 installed, macOS installed Retina, actual hosted product и canonical backend readback не заменяются этими fixtures. `fullDoDClosed:false`.
