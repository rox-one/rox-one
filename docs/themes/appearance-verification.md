# Проверка оформления ROX

Работа выполнена в отдельном checkout от `29e86bcc515e24039a15a781d5885b272cbad1df`, ветка `codex/rox-zed-appearance-20261003`. Исходная release-копия не изменялась: её 19 конфликтующих файлов принадлежат незавершённому слиянию владельца. Перенос изменений и проверка объединённой release-ревизии выполняются после завершения того слияния.

## Границы доказательств

Проверка разделяет профильные unit-тесты, собранный browser fixture, готовый WebUI с настоящим сервером и живое окно Electron. Fixture использует реальные компоненты, CSS и ThemeProvider, но его terminal transport возвращает только заранее заданный ANSI-вывод. Он не подтверждает работу нативного backend. WebUI с недоступной доменной операцией также не подтверждает редактирование заметок или исполнение команд.

macOS проверяется на отдельном профиле ROX, без чтения пользовательских сессий или конфигурации. Новые фоновые изображения в продукт не добавлены. Однотонные светлая и тёмная HTML-страницы используются только как фон за тестовым окном. Windows Mica требует отдельного запуска на Windows; моделирование платформенной политики в тесте не является нативной приёмкой Mica.

## Завершённые профильные проверки

| Проверка | Результат | Локальный журнал |
| --- | --- | --- |
| Регрессии production-компонентов renderer/shared UI | 531 pass, 0 fail; 2581 assertions, 102 файла | `/tmp/rox-zed-production-regression-final.log` |
| Синтаксис, ANSI, материал, подписки и web preferences | 40 pass, 0 fail; 313 assertions, 9 файлов | `/tmp/rox-zed-focused-final.log` |
| Локализация | 278 pass, 0 fail; 6004 assertions, 87 файлов; 12 фактических локалей | `/tmp/rox-zed-i18n-final.log` |
| Хранение настроек и контракты тем | 24 pass, 0 fail; 405 assertions | `/tmp/rox-zed-final-types.lQocxj/storage-theme-tests.log` |
| Контраст на стекле, вложенные заливки и opaque RGB fallback | 20 pass, 0 fail; 1523 assertions | `/tmp/rox-zed-opaque-token-tests.log` |
| Cookie-authenticated WebUI appearance gate | 8 pass, 0 fail; 71 assertions | `/tmp/rox-zed-web-rpc-tests-final.txt` |
| Existing WebSocket transport | 11 pass, 0 fail; 22 assertions | `/tmp/rox-zed-web-transport-regression.txt` |
| Browser adapter: workspace после server acknowledgement | 6 pass, 0 fail; 16 assertions | `/tmp/rox-zed-web-adapter-tests-final.txt` |
| Legacy vibrancy source contract | 7 pass, 0 fail; 14 assertions | `/tmp/rox-zed-vibrancy-final.log` |

Проверка типов Electron, UI, WebUI, server-core и server завершилась с exit 0; точные результаты и журналы находятся в `/tmp/rox-zed-typecheck-receipts/result.json`. Проверка shared вернула 10 ошибок в существующих `gstack-boundaries.test.ts`, `gstack-design-security.test.ts`, `gstack-state-security.test.ts`. Эти три файла побайтно совпадают с исходным HEAD; полный shared typecheck не считается прошедшим. Последний shared журнал: `/tmp/rox-zed-glass-shared-types.log`, exit 2.

## Найденные ошибки и восстановление

1. Широкие правила blurred/scenic затрагивали рабочие поверхности. Теперь материал применяется только к обозначенному обрамлению; рабочие поверхности, composer, code и terminal остаются непрозрачными.
2. Вложенные navigation wrappers накладывали материал дважды. Материал рисует внешняя панель; её внутренний chrome wrapper прозрачен и не размывает фон повторно.
3. Некоторые исходные подписи проходили 4,5:1 на сплошном фоне, но теряли контраст на стекле. Поправки UI-текста проверяются на худшем светлом/тёмном композите при согласованных 84/82/88%; исходные ANSI-цвета сохранены.
4. Tailwind/Lightning CSS в production сворачивал `backdrop-filter` и `-webkit-backdrop-filter` в единственную WebKit-декларацию. Настройки обоих Vite-клиентов отключают этот промежуточный optimizer; финальная CSS-минификация Vite сохраняет оба свойства. Приёмка проверяет вычисленное размытие готовой сборки, а не только исходный CSS.
5. WebUI раньше запрещал существующие theme RPC и мог рендерить toaster вне ThemeProvider. Используется узкое разрешение существующих appearance-каналов для проверенной session cookie и текущего workspace; пользовательский интерфейс монтируется после ответа сервера. Негативные проверки покрывают bearer reconnect, чужой workspace, отсутствующий/повреждённый config и небезопасные ID.
6. Асинхронные сохранения и initial reads могли возвращать устаревший выбор. Записи сериализованы, применение/рассылка выполняются после успешной записи; устаревшие чтения отбрасываются.
7. Compact navigator помещает chrome wrapper напрямую, desktop — через дополнительный div. Оба варианта теперь исключают повторное стекло.
8. Поддержка backdrop-filter не означает поддержку relative color syntax. Для таких браузеров resolver выдаёт шесть гарантированно непрозрачных RGB-токенов: canvas/paper/navigator/input/titlebar/toolbar. Числовые HEX/RGB/HSL/OKLCH цвета нормализуются; неизвестные сложные формы возвращаются к непрозрачному фону темы или безопасному светлому/тёмному фону. CSS отключает стекло и использует эти значения. Исходные пользовательские переменные не переписываются.

## Повторение приёмки

Собранный fixture: `apps/electron/src/renderer/components/app-shell/__tests__/zed-appearance/appearance.browser.test.ts`.

Production WebUI: `scripts/test/zed-appearance-web-acceptance.ts`, параметры и ограничения описаны в [web contract](zed-web-appearance.md).

Native observer: `scripts/test/zed-appearance-native-observe.ts`. Он подключается только к явно указанному disposable workspace, читает computed styles и material snapshot, сохраняет хэши содержимого вместо текста. Действия в живом окне выполняются через supported computer-use surface.

Итоговые ревизия, хэши сборок, browser/native receipts и ещё не пройденные внешние проверки добавляются после финальной сборки. Масштаб 100/125/150% в автоматизированной веб-матрице означает layout/DPR emulation; это не проверка команды масштаба в нативном меню браузера.
