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
| Cookie-authenticated WebUI appearance gate, включая withdrawal race | 16 pass, 0 fail; 106 assertions | `/tmp/rox-zed-final-appearance-write-fence.test.log` |
| Existing WebSocket transport | 11 pass, 0 fail; 22 assertions | `/tmp/rox-zed-web-transport-regression.txt` |
| Browser adapter: workspace после server acknowledgement | 6 pass, 0 fail; 16 assertions | `/tmp/rox-zed-web-adapter-tests-final.txt` |
| Web startup и подтверждённые метаданные workspace | 22 pass, 0 fail; 79 assertions | `/tmp/rox-zed-web-startup-final.log` |
| Legacy vibrancy source contract | 7 pass, 0 fail; 14 assertions | `/tmp/rox-zed-vibrancy-final.log` |
| Собранный fixture реальных компонентов | 29 pass, 0 fail; 575 assertions | `fixtures/fixture-final-browser.log` в каталоге доказательств |
| Production WebUI: четыре темы × семь экранов | 28 случаев pass; 0 uncaught page errors | `web/final-81e13ce4/acceptance.json` |
| Production WebUI: 375/1440px, 100/125/150% | 42 случая pass; layout/DPR emulation | тот же receipt; 43 PNG для всей web-проверки |
| Доступность узкой формы и меню | 414 bounds, 92 непустые pointer hit checks, 6 menu cases и 6 post-menu form checks | тот же receipt |
| Стабильность capture и рабочие поверхности | 43 post-capture viewport/DPR readbacks, 70 opaque reading panes | тот же receipt |

Проверка типов Electron, UI, WebUI, server-core и server завершилась с exit 0; точные результаты и журналы находятся в `/tmp/rox-zed-typecheck-receipts/result.json`. Electron и WebUI повторно проверены после финальных исправлений на `81e13ce4`, оба exit 0 (`/tmp/rox-zed-final-81e13ce4-electron-types.log`, `/tmp/rox-zed-final-81e13ce4-web-types.log`). Проверка shared вернула 10 ошибок в существующих `gstack-boundaries.test.ts`, `gstack-design-security.test.ts`, `gstack-state-security.test.ts`. Эти три файла побайтно совпадают с исходным HEAD; полный shared typecheck не считается прошедшим. Последний shared журнал: `/tmp/rox-zed-opaque-shared-types.log`, exit 2; сравнение с base — `baseline-typecheck.json` в каталоге доказательств.

## Найденные ошибки и восстановление

1. Широкие правила blurred/scenic затрагивали рабочие поверхности. Теперь материал применяется только к обозначенному обрамлению; рабочие поверхности, composer, code и terminal остаются непрозрачными.
2. Вложенные navigation wrappers накладывали материал дважды. Материал рисует внешняя панель; её внутренний chrome wrapper прозрачен и не размывает фон повторно.
3. Некоторые исходные подписи проходили 4,5:1 на сплошном фоне, но теряли контраст на стекле. Поправки UI-текста проверяются на худшем светлом/тёмном композите при согласованных 84/82/88%; исходные ANSI-цвета сохранены.
4. Tailwind/Lightning CSS в production сворачивал `backdrop-filter` и `-webkit-backdrop-filter` в единственную WebKit-декларацию. Настройки обоих Vite-клиентов отключают этот промежуточный optimizer; финальная CSS-минификация Vite сохраняет оба свойства. Приёмка проверяет вычисленное размытие готовой сборки, а не только исходный CSS.
5. WebUI раньше запрещал существующие theme RPC и мог рендерить toaster вне ThemeProvider. Используется узкое разрешение существующих appearance-каналов для проверенной session cookie и текущего workspace; пользовательский интерфейс монтируется после ответа сервера. Негативные проверки покрывают bearer reconnect, чужой workspace, отсутствующий/повреждённый config и небезопасные ID.
6. Асинхронные сохранения и initial reads могли возвращать устаревший выбор. Записи сериализованы, применение/рассылка выполняются после успешной записи; устаревшие чтения отбрасываются.
7. Compact navigator помещает chrome wrapper напрямую, desktop — через дополнительный div. Оба варианта теперь исключают повторное стекло.
8. Поддержка backdrop-filter не означает поддержку relative color syntax. Для таких браузеров resolver выдаёт шесть гарантированно непрозрачных RGB-токенов: canvas/paper/navigator/input/titlebar/toolbar. Числовые HEX/RGB/HSL/OKLCH цвета нормализуются; неизвестные сложные формы возвращаются к непрозрачному фону темы или безопасному светлому/тёмному фону. CSS отключает стекло и использует эти значения. Исходные пользовательские переменные не переписываются.
9. Production WebUI не передавал подтверждённые сервером метаданные workspace в App, и раздел workspace-тем не появлялся в настройках. Отдельный bootstrap загружает только подтверждённые ID/имена, повторно проверяет текущую привязку после ожидания и отменяет устаревший результат; native authority остаётся неизменной. После исправления реальный UI проверяет выбор Siri поверх app Min, сохранённую конфигурацию, reload, вторую вкладку и сброс override.
10. Дополнительное ревью выявило смену default workspace после admission, пока theme handler ожидал imports. Проверка только после handler отклоняла response, но уже не отменяла запись. Непосредственно перед loader/write/broadcast теперь повторяется немутирующая проверка привязки. Byte-level отрицательный контроль также выявил metadata repair внутри `getWorkspaces()` до setter; guard перенесён перед loader. Семь реальных WS-сценариев требуют `AUTH_FAILED`, неизменных байтов обоих config и отсутствия push; положительный контроль разрешает четыре операции при прежней привязке. Первый probe и неуспешная версия byte-level теста сохранены в истории.
11. Визуальное ревью narrow PNG выявило обрезанную форму Appearance при 375px/150%, хотя root scrollWidth не увеличивался. Отрицательный контроль обнаружил 13 обрезанных controls из 69. Узкие container rules этой страницы размещают label/control последовательно и переносят segmented choices; размеры шрифта и wide density сохраняются. Popup width учитывает существующий CSS zoom WebUI. Финальный oracle проверяет границы кнопок/полей внутри видимой панели и открывает оба меню с клавиатуры на каждом узком масштабе.

## Финальная ревизия и сборки

Production-код, обе сборки и финальная WebUI-матрица привязаны к `81e13ce4dade3ee965bf3c42f49deaeac0e21dc2`. Последующие изменения этого отчёта и плана не меняют production-код. `bun run electron:build` и `bun run webui:build` завершились с exit 0; журналы `/tmp/rox-zed-desktop-final-81e13ce4-build.log` и `/tmp/rox-zed-web-final-81e13ce4-build.log`. Предупреждения о крупных chunks и существующих duplicate switch cases сохранены в журнале.

Каталог локальных доказательств: `/Users/t/Pictures/Shots/Agents/rox-zed-appearance/`. Машинный manifest [appearance-evidence.json](appearance-evidence.json) содержит SHA-256 файлов сборки, финальных receipts, PNG и журналов. Файлы доказательств остаются локальными и не включают auth-state, cookies, HAR или пользовательские сессии.

Fixture собран через production Vite и контролирует хэши потребляемых исходников до/после: `sourcesUnchangedDuringRun=true`, Chromium `155.0.8059.12`, Bun `1.4.2`. Он подтверждает роли 0/4/6px, отсутствие layout-зазора, один разделитель, зоны мыши/сенсора 12/24px, клавиатурное изменение/reset/cancel, свёртку/инспектор/нижний dock, opaque code/composer/terminal, смену тем, сохранение текста/вывода и fallback. PNG трёх палитр в `fixtures/palette-*.png` показывают реальные компоненты с искусственным transport, а не полный native backend.

Финальный WebUI использует настоящий сервер и отдельный профиль: 28 сочетаний новых трёх и старого Pierre preset с Главной, Сессиями, Заметками, Задачами, Встречами, Входящими и Настройками; 42 responsive-проверки, 43 PNG, 0 uncaught errors. Проверены 414 границ controls, 92 непустые pointer hit checks, 6 фактических menu cases, 6 post-menu form checks, 43 post-capture viewport/DPR readbacks и 70 opaque reading panes. Подтверждены opposite OS mode, успешная запись/readback, reload, live second-tab sync, workspace priority/clear, непрозрачный материал/reload и high contrast. Execution log: `/tmp/rox-zed-web-ui-81e13ce4-final-hit-test.txt`. Экран Notes явно возвращает существующий `CAPABILITY_UNAVAILABLE`; также видны недоступные session/meeting/balance операции. Это приёмка оформления этих состояний, а не редактирования реального документа или работы backend terminal.

Финальный Electron был полностью перезапущен из собственной сборки, без `--disable-gpu`, с отдельными config/user-data. Read-only receipt `native/final-81e13ce4/relaunched-home.json` подтверждает native acknowledgement `material=vibrancy`, Nordfox/dark, radius 0px, topbar 84%/20px, rail 82%/20px, inspector 88%/20px; внутренний navigator не накладывает материал повторно, content и dock непрозрачны. Этот receipt не заменяет визуальную проверку влияния фона за окном.

## Ещё не принятые внешние проверки

- Mac заблокирован; supported computer-use surface повторно подтвердил невозможность получить живой экран. Требуется ручная разблокировка для финальных native PNG, прохода семи экранов, обеих подложек, второго окна и полного native code/notes/terminal сценария. Предварительные native screenshots помечены `pre-final` и не выдаются за доказательства финального поведения.
- Нужен Windows-хост для реальной Mica: unit/fixture policy покрытие не является native Windows-проверкой.
- Native browser menu zoom 100/125/150% не проверен; автоматизированная матрица использует layout/DPR emulation.
- Release-ветка всё ещё имеет 19 конфликтующих файлов в рабочей копии владельца. Перенос и проверки объединённой ревизии остаются после завершения его слияния. Draft-ветка не считается принятой release-сборкой.
- Полный shared typecheck остаётся с 10 исходными ошибками; сборки и пять профильных typechecks этого изменения успешны.

## Повторение приёмки

Собранный fixture: `apps/electron/src/renderer/components/app-shell/__tests__/zed-appearance/appearance.browser.test.ts`.

Production WebUI: `scripts/test/zed-appearance-web-acceptance.ts`, параметры и ограничения описаны в [web contract](zed-web-appearance.md).

Native observer: `scripts/test/zed-appearance-native-observe.ts`. Он подключается только к явно указанному disposable workspace, читает computed styles и material snapshot, сохраняет хэши содержимого вместо текста. Действия в живом окне выполняются через supported computer-use surface.

Масштаб 100/125/150% в автоматизированной веб-матрице означает layout/DPR emulation; это не проверка команды масштаба в нативном меню браузера. Исходные неуспешные проверки сохранены отдельно от финального receipt: production CSS blur, отсутствие workspace metadata, withdrawal race и узкая форма сначала выявлены на реальном UI/WS, исправлены и повторно проверены. Отдельный screenshot-harness дефект восстанавливал сохранённый Playwright viewport 1440px после внешнего CDP emulation 250px; он создавал неверные narrow PNG при правильных pre-capture bounds. Финальный harness создаёт отдельный Playwright context для каждого viewport/DPR, без внешнего CDP metric override. После каждого capture он повторно проверяет размеры и DPR, после меню — видимость формы, bounds и фактическое попадание указателя. Hit check требует хотя бы один видимый enabled control, чтобы исключить пустую проверку. Три промежуточных harness failures сохранены отдельно с причинами incomplete; этот дефект инструмента не стал причиной изменения production Escape handling.
