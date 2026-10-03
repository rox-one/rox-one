# Внешний вид в настоящем web UI

Web использует тот же renderer, ThemeProvider и существующие RPC выбора темы, что и desktop. Это не gallery и не подменённый экран. Для приёмки используется отдельный headless сервер, отдельный временный config и Chromium без открытия нативных окон.

## Граница доступа

Каналы `theme:getApp/getPresets/loadPreset/getColorTheme/setColorTheme/broadcastPreferences/getWorkspaceColorTheme/setWorkspaceColorTheme/getAllWorkspaceThemes/broadcastWorkspaceTheme` остаются `LOCAL_ONLY` для обычного bearer-клиента. Standalone server с включённым web UI разрешает только этот набор при успешной проверке JWT session cookie на WebSocket upgrade.

Признак cookie-проверки создаёт сервер; handshake не может присвоить его. Он участвует в проверке reconnect identity, поэтому reconnect с bearer не наследует cookie-доступ. Browser должен быть связан с текущим default workspace, который сервер читает из registry и folder config без repair. Проверка выполняется при handshake, request, после ожидаемых handler imports непосредственно перед чтением/записью и перед response. Переключение default workspace или отсутствующий/повреждённый config закрывает доступ; отклонённый запрос не успевает изменить сохранённую тему.

Workspace theme read/write/broadcast принимает только ID связанного workspace. Список overrides и события для web ограничены этим workspace. Native authority, доступ к чужим рабочим пространствам, создание рабочих пространств и остальные desktop RPC не расширяются.

ID пресета — непрозрачное имя файла: пробелы, точки и Unicode сохраняются; `/`, `\\`, NUL, точные `.`/`..` и имена длиннее 250 UTF-8 байт запрещены. Web читает только regular JSON-файлы из директории тем, проверяет `PresetThemeSchema`, исключает symlinks и generic JSON. DTO не содержит host path. `file:` и относительные фоновые изображения не передаются в browser; допустимы HTTP(S) и image data URL. Выбор пресета проверяет его существование. Общие setters отклоняют отсутствующий/повреждённый config и проверяют записанное значение перед успешным ответом.

Существующий `/api/config/workspaces` возвращает только `id`/`name` текущего workspace. Browser adapter строит по этой metadata и server-acknowledged ID один workspace DTO без filesystem path, remote credentials или host roster. Это metadata для renderer, не native authority. Перед применением `loadAuthenticatedWebWorkspaceMetadata` проверяет web runtime и bound ID до/после асинхронного чтения, исключает чужие ID/невалидные имена и заново строит минимальный DTO. `callerAuthority` остаётся `null`; это не разрешает host session или native операции.

Web ThemeProvider и Toaster монтируются после готовности authenticated transport: первоначальные config/preset reads выполняются через настоящий API.

## Повторяемая проверка

```sh
bun test packages/server-core/src/webui/__tests__/appearance-rpc.test.ts
bun test packages/server-core/src/transport/__tests__/server-lifecycle.test.ts
bun test apps/webui/src/adapter/web-api.test.ts
bun test apps/electron/src/renderer/lib/__tests__/authenticated-web-workspace-metadata.test.ts
bun scripts/test/zed-appearance-web-acceptance.ts
```

Сервер должен быть заранее запущен с built `apps/webui/dist`, loopback bind и отдельным disposable config. Для девелоперского standalone запуска `CRAFT_BUNDLED_ASSETS_ROOT` указывает на `apps/electron`, где находится `resources/themes`, а не на корень monorepo.

Скрипт принимает `ROX_APPEARANCE_TEST_URL`, `ROX_APPEARANCE_TEST_TOKEN_FILE`, `ROX_APPEARANCE_TEST_ARTIFACTS`, `ROX_APPEARANCE_TEST_CHROMIUM`. Токен читается только в память. Cookie state, network bodies, HAR и traces не записываются. В артефактах остаются изображения интерфейса, computed styles, название маршрута/темы, build index SHA-256, hashes трёх bundled presets и результаты проверок. Настоящий theme API должен вернуть точные текущие bundled palettes без host path. В disposable profile перед финальным запуском обновляются только три тестовых preset-файла: обычный `ensurePresetThemes()` намеренно сохраняет валидные существующие пользовательские файлы.

Матрица: Nordfox/Min при светлой системной теме, Siri при тёмной, существующая Pierre; Home, Sessions, Notes, Tasks, Meetings, Inbox, Appearance settings. Дополнительно проверяются API readback, reload, второй tab и живое обновление второго tab, приоритет workspace theme над app default с reload/clear, явная непрозрачность с reload и high-contrast fallback, сохранение шрифтов, радиусы/opaque reading panes/singleton stylesheet/scenic cleanup; ширины 1440 и 375 при 100/125/150% layout/DPR emulation. Последнее воспроизводит размеры layout и DPR при zoom; оно не доказывает работу нативного меню масштаба Chromium.

На Appearance проверяется горизонтальная граница каждого `button`/`input`/`select` внутри строки и видимой content pane, включая элементы ниже вертикального scroll viewport. Отсутствие root overflow само по себе не считается доказательством доступности формы: предок может скрывать обрезанный control. Для видимых включённых controls проверяется фактическое попадание `elementFromPoint()` в control; требуется хотя бы один такой control, чтобы проверка не могла пройти с пустым набором. Inert/offscreen форма не считается доступной. Theme и material menus отдельно открываются на каждой узкой ширине/zoom; проверяются viewport collision padding, выбор через настоящий API/предпочтение и восстановление focus после Space/Escape. После закрытия каждого menu снова проверяются видимость формы, границы и попадание указателя; после каждого screenshot — сохранение viewport/DPR.

Appearance имеет собственный CSS container: при ширине pane до 480px строки располагают controls под label, segmented choices переносятся, range/menu controls ограничены шириной строки. Это относится только к Appearance и не меняет desktop density или общий SettingsRow/ScrollArea. Portal menu сохраняет обычные 280px, но ограничивается `100vw / root CSS zoom - 16px`, чтобы Radix collision detection мог разместить его в узком viewport. Текущий CSS zoom измеряется при открытии и resize: существующий narrow web CSS использует `html { zoom: 1.2 }`, а viewport units и Radix available width остаются немасштабированными.

## Текущее подтверждение

- Реальный WS + JWT cookie + существующие handlers: **16 tests, 106 assertions, 0 failures** (`/tmp/rox-zed-final-appearance-write-fence.test.log`). Есть negative controls для bearer, invalid/no cookie, unbound/foreign workspace, cookie→bearer reconnect, path traversal/generic JSON/symlink, invalid theme/preferences, custom Unicode ID, missing/corrupt registry/folder и смены default workspace. Детерминированная проверка withdrawal во время ожидаемого import подтверждает отказ перед чтением/записью и сохранение исходных bytes; сохранённое разрешение продолжает работать.
- Существующий transport lifecycle: **11 tests, 22 assertions, 0 failures**.
- Browser adapter: **6 tests, 16 assertions, 0 failures**. Workspace metadata не появляется до server acknowledgment; после него renderer получает только один ID/name DTO с пустым host path и без native authority.
- Scoped metadata helper: **5 tests, 14 assertions, 0 failures**. Проверены смена binding во время чтения, фильтрация чужих/невалидных записей и исключение host path/native authority/credential fields.
- Production UI matrix на **`81e13ce4dade3ee965bf3c42f49deaeac0e21dc2`**: **28 theme × route cases, 42 responsive cases, 0 page errors**, процесс проверки завершился с exit **0**. Полный Electron build, web build и свежие Electron/Web typechecks этого revision отдельно завершились с exit **0**.

Финальный production сервер перезапущен на этом source revision, PID `93480`, bind `127.0.0.1:9199`, отдельный disposable profile. Проверка не использует прежний Bun process или CSS injection. Execution log: `/tmp/rox-zed-web-ui-81e13ce4-final-hit-test.txt`; server log: `/tmp/rox-zed-appearance-web/server-final-81e13ce4.log`; web build log: `/tmp/rox-zed-web-final-81e13ce4-build.log`.

Stable receipt: `/Users/t/Pictures/Shots/Agents/rox-zed-appearance/web/final-81e13ce4/acceptance.json`. В этом же каталоге находятся **43 PNG** и `artifact-manifest.json` с hashes всех screenshots и **394** built JS/CSS/HTML assets. Подтверждены **414** горизонтальных bounds controls, **92** непустые hit-проверки видимых controls до menu interaction, **6** фактических theme/material menu cases, **6** повторных проверок формы после menu и **43** post-screenshot metric readbacks. Для **70** reading panes computed background полностью opaque и без blur. Внешняя оболочка имеет `blur(20px)`; внутренние вложенные chrome surfaces прозрачны и не добавляют второй blur. Вручную просмотрены свежие три themed Home screenshots и узкая Appearance форма при 375/100, 375/125 и 375/150: форма видима, controls переносятся и помещаются в pane.

Reload, второй tab, живое изменение второго tab, readback существующего theme API, приоритет Siri workspace theme над Min app default с reload/clear, явный opaque material с reload, high-contrast solid fallback и возврат glass прошли. Все три API palettes совпали с текущими bundled JSON. CDP platform-font readback подтвердил настоящий `Arial Narrow` для семи glyphs; это read-only проверка фактически использованного шрифта, не только CSS family.

| Артефакт | SHA-256 |
|---|---|
| `acceptance.json` | `4fcf8a4af7f1ecb30df8cfd1165b24907d133f228353517a6f5cbaadf506540f` |
| `artifact-manifest.json` | `13e58244a0f5a6c1ee30765179560ee7c2257cd0ed117f1bcc3012a8893b7fcd` |
| Выполненный `scripts/test/zed-appearance-web-acceptance.ts` | `4f9444110d8a28a63b4306c3c3815913a4c2fa9cf1dea1acc8833d0fbff8584d` |
| Built `apps/webui/dist/index.html` | `3b94526829048bad9521512d23b530645e8b934841ae1013bab5bfaf4f568d2e` |

Каждая responsive комбинация имеет собственный Playwright browser context, который одновременно задаёт viewport и `deviceScaleFactor`. Внешние CDP metric overrides не используются. Физические 375px моделируются как 375/300/250 CSS px при DPR 1/1.25/1.5; физические 1440px — как 1440/1152/960 CSS px. После screenshot проверка снова читает размер и DPR. Это layout/DPR emulation; нативное меню zoom браузера не проверялось.

Предварительная production-проба выявила потерю стандартного `backdrop-filter` при CSS minification: реальный Nordfox/Home и theme API работали, но computed blur оболочки был `none`. Проверка остановилась на этом несоответствии. Эта проба не считается пройденной приёмкой; финальный запуск сохраняет обязательную проверку blur.

На первой frozen production сборке `1a17b9a9` прошли все 28 theme × route cases и reload/second-tab/live-tab/API readback, затем проверка остановилась на отсутствующей секции workspace themes. Адаптер возвращал safe metadata, но App не применял её, поскольку общая загрузка roster требовала `callerAuthority`, а web корректно сохраняет его `null`. Failed receipt и screenshot сохранены отдельно; helper/effect исправляют только отображение bound metadata. Итоговая приёмка выполняется повторно на новой сборке.

Сборка `4881e540` прошла первоначальные 28 theme × route, 42 layout/DPR cases, persistence, workspace priority и material assertions, однако последующий просмотр screenshot обнаружил обрезанную Appearance форму при 375/150% (250 CSS px). Первоначальный oracle проверял только root overflow и computed styles; такой `pass` не является полной responsive приёмкой. Receipt и screenshot сохранены вместе с `post-matrix-review.json`, который фиксирует incomplete. Scoped layout исправление и расширенный oracle повторно проверены на финальной сборке. Отдельная временная CSS-проба служила диагностикой и не подменяет production результат. На том же revision независимый review нашёл withdrawal race в cookie-bound appearance writes; финальный запуск использовал свежий server process с исправленными handler imports.

Три промежуточных запуска harness на `81e13ce4` также сохранены отдельно, без изменения production source:

- `web/first-81e13ce4-harness-incomplete`: external CDP viewport не совпадал с зарегистрированным Playwright viewport; screenshot восстанавливал широкую layout и показывал navigator вместо формы. Предположение о product Escape bug проверено и не подтвердилось.
- `web/second-81e13ce4-harness-dpr-incomplete`: viewport был согласован, но external CDP DPR сбрасывался после capture. Post-screenshot guard остановил проверку.
- `web/third-81e13ce4-harness-hit-test-incomplete`: собственные contexts сохранили все metrics, но последующий review обнаружил пустую hit-проверку из-за чтения нулевой геометрии Radix `style` child вместо ScrollArea root. Этот запуск не принят; финальный oracle читает настоящий scroll viewport и требует непустой набор видимых controls.

Все эти каталоги находятся под `/Users/t/Pictures/Shots/Agents/rox-zed-appearance/`; их `post-matrix-review.json` сохраняет точную причину incomplete. Только `web/final-81e13ce4` содержит итоговую строгую passed receipt.

Доступность Notes, session history и interactive terminal определяется существующим доменным/native transport. В четырёх theme cases Notes показал `notes-authority-unavailable` / `CAPABILITY_UNAVAILABLE`; Sessions показывал «Сессии: Недоступно», а Home — существующие недоступные доменные данные. Эти состояния записаны в receipt. Отрисованное состояние «Недоступно» не подтверждает editor, document persistence, backend terminal или ANSI output. Матрица не создаёт настоящий документ, code attachment, session transcript или backend terminal. Такие поверхности требуют отдельной проверки через доступный transport; компонентные и synthetic fixture результаты учитываются отдельно.

Web подтверждение не закрывает полную native приёмку. Финальная нативная foreground проверка именованных маршрутов и свежие macOS screenshots требуют разблокированного экрана; Windows/Mica в этой среде не проверялись. Сборка, read-only native receipt и web screenshots не заменяют эти оставшиеся проверки.
