# Внешний вид в настоящем web UI

Web использует тот же renderer, ThemeProvider и существующие RPC выбора темы, что и desktop. Это не gallery и не подменённый экран. Для приёмки используется отдельный headless сервер, отдельный временный config и Chromium без открытия нативных окон.

## Граница доступа

Каналы `theme:getApp/getPresets/loadPreset/getColorTheme/setColorTheme/broadcastPreferences/getWorkspaceColorTheme/setWorkspaceColorTheme/getAllWorkspaceThemes/broadcastWorkspaceTheme` остаются `LOCAL_ONLY` для обычного bearer-клиента. Standalone server с включённым web UI разрешает только этот набор при успешной проверке JWT session cookie на WebSocket upgrade.

Признак cookie-проверки создаёт сервер; handshake не может присвоить его. Он участвует в проверке reconnect identity, поэтому reconnect с bearer не наследует cookie-доступ. Browser должен быть связан с текущим default workspace, который сервер читает из registry и folder config без repair. Проверка выполняется при handshake, request и перед response. Переключение default workspace или отсутствующий/повреждённый config закрывает доступ.

Workspace theme read/write/broadcast принимает только ID связанного workspace. Список overrides и события для web ограничены этим workspace. Native authority, доступ к чужим рабочим пространствам, создание рабочих пространств и остальные desktop RPC не расширяются.

ID пресета — непрозрачное имя файла: пробелы, точки и Unicode сохраняются; `/`, `\\`, NUL, точные `.`/`..` и имена длиннее 250 UTF-8 байт запрещены. Web читает только regular JSON-файлы из директории тем, проверяет `PresetThemeSchema`, исключает symlinks и generic JSON. DTO не содержит host path. `file:` и относительные фоновые изображения не передаются в browser; допустимы HTTP(S) и image data URL. Выбор пресета проверяет его существование. Общие setters отклоняют отсутствующий/повреждённый config и проверяют записанное значение перед успешным ответом.

Существующий `/api/config/workspaces` возвращает только `id`/`name` текущего workspace. Browser adapter строит по этой metadata и server-acknowledged ID один workspace DTO без filesystem path, remote credentials или host roster. Это metadata для renderer, не native authority.

Web ThemeProvider и Toaster монтируются после готовности authenticated transport: первоначальные config/preset reads выполняются через настоящий API.

## Повторяемая проверка

```sh
bun test packages/server-core/src/webui/__tests__/appearance-rpc.test.ts
bun test packages/server-core/src/transport/__tests__/server-lifecycle.test.ts
bun test apps/webui/src/adapter/web-api.test.ts
bun scripts/test/zed-appearance-web-acceptance.ts
```

Сервер должен быть заранее запущен с built `apps/webui/dist`, loopback bind и отдельным disposable config. Для девелоперского standalone запуска `CRAFT_BUNDLED_ASSETS_ROOT` указывает на `apps/electron`, где находится `resources/themes`, а не на корень monorepo.

Скрипт принимает `ROX_APPEARANCE_TEST_URL`, `ROX_APPEARANCE_TEST_TOKEN_FILE`, `ROX_APPEARANCE_TEST_ARTIFACTS`, `ROX_APPEARANCE_TEST_CHROMIUM`. Токен читается только в память. Cookie state, network bodies, HAR и traces не записываются. В артефактах остаются изображения интерфейса, computed styles, название маршрута/темы, build index SHA-256, hashes трёх bundled presets и результаты проверок. Настоящий theme API должен вернуть точные текущие bundled palettes без host path. В disposable profile перед финальным запуском обновляются только три тестовых preset-файла: обычный `ensurePresetThemes()` намеренно сохраняет валидные существующие пользовательские файлы.

Матрица: Nordfox/Min при светлой системной теме, Siri при тёмной, существующая Pierre; Home, Sessions, Notes, Tasks, Meetings, Inbox, Appearance settings. Дополнительно проверяются API readback, reload, второй tab и живое обновление второго tab, приоритет workspace theme над app default с reload/clear, явная непрозрачность с reload и high-contrast fallback, сохранение шрифтов, радиусы/opaque reading panes/singleton stylesheet/scenic cleanup; ширины 1440 и 375 при 100/125/150% layout/DPR emulation. Последнее воспроизводит размеры layout и DPR при zoom; оно не доказывает работу нативного меню масштаба Chromium.

## Текущее подтверждение

- Реальный WS + JWT cookie + существующие handlers: **8 tests, 71 assertions, 0 failures**. Есть negative controls для bearer, invalid/no cookie, unbound/foreign workspace, cookie→bearer reconnect, path traversal/generic JSON/symlink, invalid theme/preferences, custom Unicode ID, missing/corrupt registry/folder и смены default workspace.
- Существующий transport lifecycle: **11 tests, 22 assertions, 0 failures**.
- Browser adapter: **6 tests, 16 assertions, 0 failures**. Workspace metadata не появляется до server acknowledgment; после него renderer получает только один ID/name DTO с пустым host path и без native authority.
- Итоговая production UI matrix и screenshots записываются только после финальной сборки. Их статус и ограничения приведены в итоговом отчёте приёмки.

Предварительная production-проба выявила потерю стандартного `backdrop-filter` при CSS minification: реальный Nordfox/Home и theme API работали, но computed blur оболочки был `none`. Проверка остановилась на этом несоответствии. Эта проба не считается пройденной приёмкой; финальный запуск сохраняет обязательную проверку blur.

Доступность Notes, session history и interactive terminal определяется существующим доменным/native transport. Отрисованное состояние «Недоступно» не подтверждает editor, document persistence, backend terminal или ANSI output. Эти поверхности требуют отдельной проверки через настоящий доступный transport; скрипт перечисляет такие ограничения явно и не подменяет их fixture-данными.
