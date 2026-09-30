# Проверка cloud-среды rox-one

Проверен текущий управляемый Linux x86_64 исполнитель с checkout `/workspace/rox-one`. Наличие `/run/codex-environment` подтверждено; команды выполнялись через платформенный `exec_command`. Это проверка текущего экземпляра среды, которую пользователь сообщил как опубликованную. Отдельного инструмента чтения статуса публикации или живого `environment_status/network readiness` в сессии нет; версия публикации и восстановление в следующей задаче независимо не подтверждались.

- Репозиторий: `https://github.com/rox-one/rox-one.git`.
- HEAD: `f63294ba4fffa7238b46b24e918925a313ad0b12`; рабочая ветка `work`.
- `git ls-remote origin HEAD` вернул тот же commit; checkout не обновлялся.
- Bun 1.3.14, TypeScript 5.9.3, Vite 6.4.1; 5 CPU, около 34 GB RAM.
- Сборки, диагностику типов, тесты и runtime smoke выполняли агенты GPT-6.1 Sol с reasoning effort `ultra`. Ведущий агент координировал, проверял среду/сеть и сформировал отчёт; его модель инструментом не переключалась.
- Начальный `git status --short` пустой. Источники, тесты, манифесты, lockfile, сетевые права, настройки среды и существующие секреты не менялись. Использованы существующий checkout, восстановленные зависимости и штатные игнорируемые build outputs.

## Актуальная сеть и зависимости

Поддерживаемый `exec_command` выполнил read-only Git и HTTPS-проверки. Проверки TLS и проверки пакетов не отключались; значения переменных, токены и cookies не выводились.

| Проверка | Результат |
| --- | --- |
| `git ls-remote origin HEAD` | exit 0; commit совпал с checkout |
| HTTPS `https://registry.npmjs.org/bun` | curl exit 0, HTTP 200, 3038010 bytes |
| HTTPS `https://api.github.com/repos/WhiskeySockets/libsignal-node/tarball/1c30d7d` с redirect в codeload | curl exit 0, конечный HTTP 200, 46079 bytes |
| HTTPS `https://github.com/rox-one/rox-one` | curl exit 0, HTTP 200, 568798 bytes |

Отдельный live readiness инструмент не предоставлен. Таблица подтверждает доступ по фактическим запросам, а не только сохранённый allowlist. Это не проверка GitHub API write/push прав, внешних LLM или всех сетевых интеграций.

Frozen install повторно не требовался: `node_modules`, Bun нужной версии и обе закреплённые GitHub-зависимости восстановлены; все запрошенные сборки/проверки запустились без отсутствующих пакетов. TypeScript-ошибки перечислены ниже и не являются основанием переустанавливать зависимости. Предыдущий frozen install относится к подготовке среды, текущая проверка не выдаёт его за новый запуск.

Повторить сетевые операции:

```bash
cd /workspace/rox-one
git ls-remote origin HEAD
curl --silent --show-error --location --max-time 30 --output /dev/null --write-out '%{http_code} %{size_download}\n' https://registry.npmjs.org/bun
curl --silent --show-error --location --max-time 30 --output /dev/null --write-out '%{http_code} %{size_download}\n' https://api.github.com/repos/WhiskeySockets/libsignal-node/tarball/1c30d7d
curl --silent --show-error --location --max-time 30 --output /dev/null --write-out '%{http_code} %{size_download}\n' https://github.com/rox-one/rox-one
```

Если при повторении зависимости действительно отсутствуют, использовать существующую установку и frozen mode, не меняя lockfile:

```bash
cd /workspace/rox-one
export PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH
export BUN_INSTALL_CACHE_DIR=/workspace/.onboarding-tools/bun-cache
export npm_config_cache=/workspace/.onboarding-tools/npm-cache
ELECTRON_SKIP_BINARY_DOWNLOAD=1 bun install --frozen-lockfile
```

## Сборки, типы и тесты

| Команда и рабочая директория | Exit | Фактический итог |
| --- | --- | --- |
| `bun run server:build:subprocess`, root | 0 | Собрано 3340 modules; Pi bundle 32.25 MB |
| `bun run webui:build`, root | 0 | Vite production build завершён |
| `bun run webui:typecheck`, root | 2 | 52 диагностики TypeScript |
| `bun run typecheck`, `packages/server` | 2 | 8 диагностик TypeScript |
| `bun test packages/core packages/server-core/src/webui`, root | 1 | 817 pass, 3 fail, 820 tests, 79 files; 3519 expect |

Core: 804 pass / 3 fail в 77 файлах. WebUI: 13 pass / 0 fail в 2 файлах. Пропусков или нулевого выполнения в сводке нет. Сборки проходят без полной проверки типов; это не делает typecheck успешным.

Команды воспроизведения (Bun из опубликованной файловой среды):

```bash
export PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH
cd /workspace/rox-one
bun run server:build:subprocess
bun run webui:build
bun run webui:typecheck
(cd packages/server && bun run typecheck)
bun test packages/core packages/server-core/src/webui
```

## Три оставшихся тестовых ошибки

1. **`attachCredentialRef > rejects non-enumerable declared fields before registration`**. Тест объявлен в `packages/core/src/platform/identity/attach-credential-ref.test.ts:93`, assertion `:132:9`. Ожидается исключение для не-enumerable `locator.key`; исключения нет, возвращается connection с новым credentialRef и регистрируется одна запись. `attach-credential-ref.ts:36–44` проверяет только верхний уровень connection/input. `credential-types.ts:225–226` проверяет имена собственных полей, но не enumerable; `:231–239` принимает скрытый key. Классификация: дефект runtime-валидации кода.

2. **`attachCredentialRef > rejects prototype-derived locators before registry mutation`**. Тест объявлен в том же файле `:136`, `Object.create` в `:138`, assertion `:148:18`. Ожидается исключение для унаследованного locator; исключения нет, регистрируется одна запись. `credential-types.ts:231` не проверяет prototype, `:235–239` читает inherited `type/key`, а `Object.getOwnPropertyNames` в `:225` возвращает пустой список. Оба неправильных locator доходят до registry mutation в `credential-types.ts:416`. Классификация: дефект кода, не инфраструктуры.

3. **`Things lists > upcomingByDay keeps 7 calendar days and groups later by month`**. `packages/core/src/tasks/personal/things.test.ts:111`, assertion `:119:53`. Ожидается `['A']`, получено `[]`. Fixture `now` фиксирован на 2026-09-29 10:00 local (`:8`); `day(1)` назначает A на 30 сентября (`:10`, `:114`). Runtime local/UTC дата проверки — 2026-09-30. `packages/core/src/tasks/personal/store.ts:487–490` использует реальные `Date.now()`, переводит A в `today` и удаляет `startAt`; `projections.ts:83–88` исключает её из upcoming. Классификация: зависимость теста/API от текущей даты, не сбой cloud clock. После 30 сентября простое повторение может пройти. Часы, assertions и окружение теста не подменялись.

Независимые воспроизведения:

```bash
cd /workspace/rox-one
export PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH
bun test packages/core/src/platform/identity/attach-credential-ref.test.ts
# exit 1, 3 pass / 2 fail
bun test packages/core/src/tasks/personal/things.test.ts
# 2026-09-30 runtime local date: exit 1, 13 pass / 1 fail
```

## Причины ошибок типов

Четыре навигационные ошибки связаны с тем, что `apps/electron/src/renderer/components/app-shell/nav-destinations.ts:51` не включает `meetings` в union, хотя код строит и читает эту destination. Ошибки Rox2-тестов связаны с чтением canonical полей из ненормализованного `Rox2Result`, который включает legacy branches (`packages/core/src/rox2/platform-contract.ts:170`, `:194`). Эти renderer-тесты попали в typecheck; запрошенный `bun test` их не выполнял.

`Window.openClawHostControl` объявлен в `apps/electron/src/preload/openclaw-host-control.ts:42`, вне include WebUI tsconfig. Ошибка `BlobPart` в server возникает при ESNext без DOM lib, тогда как Bun предоставляет `Bun.BlobPart`; `fetch.preconnect` требуется Bun augmentation (`node_modules/bun-types/globals.d.ts:2035`). Это ошибки типовых деклараций/конфигурации в репозитории, а не отсутствующие desktop или сетевые возможности облака.

Остальные сообщения указывают на nullable значения без guards, несовпадающие структуры projects и graph nodes, избыточные проверки уже обязательных функций, слишком широкий Uint8Array/BufferSource, строку вместо literal union, устаревшее значение verification, boolean вместо literal false и union успеха без гарантированного journal. Все точные позиции и полные сообщения ниже. Сборка Web UI также выдала предупреждения о больших chunks и смешанных static/dynamic imports, но завершилась exit 0.

## Все оставшиеся диагностики TypeScript

Пути ниже относительно `/workspace/rox-one`, позиции — `file:line:column`, сообщения сохранены без сокращения. TS2304 `BlobPart` касается набора TypeScript lib/types в конфигурации пакета; TS2741 `fetch.preconnect` — несовместимости mock-функции с типом Bun fetch. Это диагностируемые дефекты кода/репозиторной типовой конфигурации, а не подтверждение отсутствия network access или cloud capability.

### webui-typecheck: exit 2, 52 диагностик

1. `apps/electron/src/renderer/components/app-shell/AppShell.tsx:2739:59` — `TS2339`

```text
Property 'meetings' does not exist on type 'Record<AppNavDestinationId, AppNavDestination>'.
```

2. `apps/electron/src/renderer/components/app-shell/AppShell.tsx:2740:56` — `TS2339`

```text
Property 'meetings' does not exist on type 'Record<AppNavDestinationId, AppNavDestination>'.
```

3. `apps/electron/src/renderer/components/app-shell/AppShell.tsx:3010:80` — `TS2339`

```text
Property 'details' does not exist on type 'never'.
Property 'details' does not exist on type 'never'.
```

4. `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx:348:29` — `TS2322`

```text
Type '{ id: string; slug: string; name: string; color?: string | undefined; }[] | undefined' is not assignable to type '{ id: string; slug: string; name: string; color?: string | undefined; }[]'.
Type 'undefined' is not assignable to type '{ id: string; slug: string; name: string; color?: string | undefined; }[]'.
```

5. `apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx:79:11` — `TS2322`

```text
Type '{ id: string; slug: string; name: string; color?: string | undefined; }[]' is not assignable to type 'LoadedProject[]'.
Type '{ id: string; slug: string; name: string; color?: string | undefined; }' is missing the following properties from type 'LoadedProject': config, folderPath, assetsPath, workspaceRootPath, workspaceId
```

6. `apps/electron/src/renderer/components/app-shell/__tests__/meetings-nav.test.ts:12:55` — `TS2367`

```text
This comparison appears to be unintentional because the types 'AppNavDestinationId' and '"meetings"' have no overlap.
```

7. `apps/electron/src/renderer/components/app-shell/nav-destinations.ts:129:5` — `TS2322`

```text
Type '"meetings"' is not assignable to type 'AppNavDestinationId'.
```

8. `apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx:195:50` — `TS2345`

```text
Argument of type 'AutomationGraphNode' is not assignable to parameter of type 'GraphLabelNode'.
Type 'AutomationGraphGroupNode' is not assignable to type 'GraphLabelNode'.
Types of property 'data' are incompatible.
Type '{ memberIds?: string[] | undefined; }' has no properties in common with type '{ event?: string | undefined; prompt?: string | undefined; text?: string | undefined; expression?: string | undefined; name?: string | undefined; matcher?: string | undefined; cron?: string | undefined; url?: string | undefined; method?: string | undefined; }'.
```

9. `apps/electron/src/renderer/pages/__tests__/rox2-native-surfaces.test.ts:95:20` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

10. `apps/electron/src/renderer/pages/__tests__/rox2-native-surfaces.test.ts:96:20` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

11. `apps/electron/src/renderer/pages/__tests__/rox2-native-surfaces.test.ts:97:20` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

12. `apps/electron/src/renderer/pages/__tests__/rox2-native-surfaces.test.ts:102:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

13. `apps/electron/src/renderer/pages/__tests__/rox2-native-surfaces.test.ts:111:20` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

14. `apps/electron/src/renderer/pages/meetings/capture-rpc.ts:45:33` — `TS2774`

```text
This condition will always return true since this function is always defined. Did you mean to call it instead?
```

15. `apps/electron/src/renderer/pages/meetings/capture-rpc.ts:45:58` — `TS2774`

```text
This condition will always return true since this function is always defined. Did you mean to call it instead?
```

16. `apps/electron/src/renderer/pages/meetings/import-rpc.ts:57:56` — `TS2345`

```text
Argument of type 'Uint8Array<ArrayBufferLike>' is not assignable to parameter of type 'BufferSource'.
Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'ArrayBufferView<ArrayBuffer>'.
Types of property 'buffer' are incompatible.
Type 'ArrayBufferLike' is not assignable to type 'ArrayBuffer'.
Property 'resize' is missing in type 'SharedArrayBuffer' but required in type 'ArrayBuffer'.
```

17. `apps/electron/src/renderer/pages/meetings/manual-rpc.ts:28:34` — `TS2774`

```text
This condition will always return true since this function is always defined. Did you mean to call it instead?
```

18. `apps/electron/src/renderer/pages/meetings/start-rpc.ts:38:34` — `TS2774`

```text
This condition will always return true since this function is always defined. Did you mean to call it instead?
```

19. `apps/electron/src/renderer/pages/meetings/use-local-meeting-readiness.ts:24:3` — `TS2322`

```text
Type '{ blocker: string | null; installed: boolean; enabled: boolean; authorized: boolean; healthy: boolean; running: boolean; id: "rox.meeting.coordinator" | "rox.meeting.assist" | "rox.meeting.scribe" | ... 4 more ... | "rox.meeting.analyst"; }[]' is not assignable to type 'AgentReadinessView[]'.
Type '{ blocker: string | null; installed: boolean; enabled: boolean; authorized: boolean; healthy: boolean; running: boolean; id: "rox.meeting.coordinator" | "rox.meeting.assist" | "rox.meeting.scribe" | ... 4 more ... | "rox.meeting.analyst"; }' is not assignable to type 'AgentReadinessView'.
Types of property 'blocker' are incompatible.
Type 'string | null' is not assignable to type '"unhealthy" | "unauthorized" | "disabled" | "not-installed" | "not-running" | null'.
Type 'string' is not assignable to type '"unhealthy" | "unauthorized" | "disabled" | "not-installed" | "not-running" | null'.
```

20. `apps/electron/src/renderer/pages/settings/SecuritySettingsPage.tsx:108:30` — `TS2339`

```text
Property 'openClawHostControl' does not exist on type 'Window & typeof globalThis'.
```

21. `apps/electron/src/renderer/pages/settings/SecuritySettingsPage.tsx:282:42` — `TS2339`

```text
Property 'openClawHostControl' does not exist on type 'Window & typeof globalThis'.
```

22. `apps/electron/src/renderer/pages/settings/SecuritySettingsPage.tsx:288:42` — `TS2339`

```text
Property 'openClawHostControl' does not exist on type 'Window & typeof globalThis'.
```

23. `apps/electron/src/renderer/pages/settings/__tests__/rox2-041-043-settings-pages.test.ts:136:21` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

24. `apps/electron/src/renderer/pages/settings/__tests__/rox2-041-043-settings-pages.test.ts:137:21` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

25. `apps/electron/src/renderer/pages/settings/__tests__/rox2-041-043-settings-pages.test.ts:138:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

26. `apps/electron/src/renderer/pages/settings/__tests__/rox2-041-043-settings-pages.test.ts:139:21` — `TS2339`

```text
Property 'receipt' does not exist on type 'Rox2Result'.
Property 'receipt' does not exist on type 'Rox2LegacyOkResult'.
```

27. `apps/electron/src/renderer/pages/settings/__tests__/rox2-044-046-settings-pages.test.ts:135:21` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

28. `apps/electron/src/renderer/pages/settings/__tests__/rox2-044-046-settings-pages.test.ts:136:21` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

29. `apps/electron/src/renderer/pages/settings/__tests__/rox2-044-046-settings-pages.test.ts:137:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

30. `apps/electron/src/renderer/pages/settings/__tests__/rox2-047-049-settings-pages.test.ts:148:21` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

31. `apps/electron/src/renderer/pages/settings/__tests__/rox2-047-049-settings-pages.test.ts:149:21` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

32. `apps/electron/src/renderer/pages/settings/__tests__/rox2-047-049-settings-pages.test.ts:150:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

33. `apps/electron/src/renderer/pages/settings/__tests__/rox2-050-052-settings-pages.test.ts:140:21` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

34. `apps/electron/src/renderer/pages/settings/__tests__/rox2-050-052-settings-pages.test.ts:141:21` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

35. `apps/electron/src/renderer/pages/settings/__tests__/rox2-050-052-settings-pages.test.ts:142:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

36. `apps/electron/src/renderer/pages/settings/__tests__/rox2-053-055-settings-pages.test.ts:154:21` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

37. `apps/electron/src/renderer/pages/settings/__tests__/rox2-053-055-settings-pages.test.ts:155:21` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

38. `apps/electron/src/renderer/pages/settings/__tests__/rox2-053-055-settings-pages.test.ts:156:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

39. `apps/electron/src/renderer/pages/settings/__tests__/rox2-056-058-settings-pages.test.ts:166:21` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

40. `apps/electron/src/renderer/pages/settings/__tests__/rox2-056-058-settings-pages.test.ts:167:21` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

41. `apps/electron/src/renderer/pages/settings/__tests__/rox2-056-058-settings-pages.test.ts:168:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

42. `apps/electron/src/renderer/pages/settings/__tests__/rox2-059-061-settings-pages.test.ts:162:21` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

43. `apps/electron/src/renderer/pages/settings/__tests__/rox2-059-061-settings-pages.test.ts:163:21` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

44. `apps/electron/src/renderer/pages/settings/__tests__/rox2-059-061-settings-pages.test.ts:164:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

45. `apps/electron/src/renderer/pages/settings/__tests__/rox2-062-shortcuts-settings-page.test.ts:95:21` — `TS2339`

```text
Property 'executionMode' does not exist on type 'Rox2Result'.
Property 'executionMode' does not exist on type 'Rox2LegacyOkResult'.
```

46. `apps/electron/src/renderer/pages/settings/__tests__/rox2-062-shortcuts-settings-page.test.ts:96:21` — `TS2339`

```text
Property 'lifecycle' does not exist on type 'Rox2Result'.
Property 'lifecycle' does not exist on type 'Rox2LegacyOkResult'.
```

47. `apps/electron/src/renderer/pages/settings/__tests__/rox2-062-shortcuts-settings-page.test.ts:97:21` — `TS2339`

```text
Property 'verification' does not exist on type 'Rox2Result'.
Property 'verification' does not exist on type 'Rox2LegacyOkResult'.
```

48. `packages/core/src/rox2/meeting-conation-shell.ts:29:40` — `TS2367`

```text
This comparison appears to be unintentional because the types '"unverified" | "receipt_verified" | "readback_verified"' and '"verified"' have no overlap.
```

49. `packages/server-core/src/meetings/conation/native-shells.ts:174:46` — `TS2322`

```text
Type 'boolean' is not assignable to type 'false'.
```

50. `packages/server-core/src/meetings/manual.ts:121:22` — `TS2339`

```text
Property 'journal' does not exist on type '{ ok: true; meeting: Meeting; } | { ok: true; meeting: Meeting; journal: MeetingJournal; }'.
Property 'journal' does not exist on type '{ ok: true; meeting: Meeting; }'.
```

51. `packages/server-core/src/meetings/manual.ts:148:22` — `TS2339`

```text
Property 'journal' does not exist on type '{ ok: true; meeting: Meeting; } | { ok: true; meeting: Meeting; journal: MeetingJournal; }'.
Property 'journal' does not exist on type '{ ok: true; meeting: Meeting; }'.
```

52. `packages/shared/src/voice/runtime.ts:177:13` — `TS2741`

```text
Property 'preconnect' is missing in type '() => Promise<never>' but required in type 'typeof fetch'.
```

### server-typecheck: exit 2, 8 диагностик

1. `packages/core/src/rox2/meeting-conation-shell.ts:29:40` — `TS2367`

```text
This comparison appears to be unintentional because the types '"unverified" | "receipt_verified" | "readback_verified"' and '"verified"' have no overlap.
```

2. `packages/server-core/src/handlers/rpc/labels.ts:72:32` — `TS18047`

```text
'workspace' is possibly 'null'.
```

3. `packages/server-core/src/handlers/rpc/messaging.ts:142:61` — `TS2322`

```text
Type 'string | null' is not assignable to type 'string | undefined'.
Type 'null' is not assignable to type 'string | undefined'.
```

4. `packages/server-core/src/meetings/conation/native-shells.ts:174:46` — `TS2322`

```text
Type 'boolean' is not assignable to type 'false'.
```

5. `packages/server-core/src/meetings/manual.ts:121:22` — `TS2339`

```text
Property 'journal' does not exist on type '{ ok: true; meeting: Meeting; } | { ok: true; meeting: Meeting; journal: MeetingJournal; }'.
Property 'journal' does not exist on type '{ ok: true; meeting: Meeting; }'.
```

6. `packages/server-core/src/meetings/manual.ts:148:22` — `TS2339`

```text
Property 'journal' does not exist on type '{ ok: true; meeting: Meeting; } | { ok: true; meeting: Meeting; journal: MeetingJournal; }'.
Property 'journal' does not exist on type '{ ok: true; meeting: Meeting; }'.
```

7. `packages/shared/src/voice/adapters/rox-transcription.ts:113:44` — `TS2304`

```text
Cannot find name 'BlobPart'.
```

8. `packages/shared/src/voice/runtime.ts:177:13` — `TS2741`

```text
Property 'preconnect' is missing in type '() => Promise<never>' but required in type 'typeof fetch'.
```

## Два цикла runtime start/stop/restart

Свежий изолированный конфиг: `/tmp/rox-validation-20260930/runtime/config`, вне checkout. Server слушал только loopback; CRAFT/ROX config направлены в один fresh каталог. Browser backend отключён для headless baseline; native sidecar отключён штатным дефолтом. Эфемерный random server token создавался отдельно для каждого цикла, существовал в памяти и environment дочернего процесса, не становился настройкой/секретом среды. Cookies также оставались в памяти. Старт осуществлялся прямым Bun Popen без промежуточного `bun run` wrapper; сигналы отправлялись только собственному PID/process group.

| Проверка | Первый запуск | Повторный запуск |
| --- | --- | --- |
| PID | 2644 | 2674 |
| Готовность health | 1.773 s | 1.558 s |
| GET `/health` | 200, status ok | 200, status ok |
| Health session_manager/memory/native_sidecar | pass/pass/pass (native disabled) | pass/pass/pass (native disabled) |
| GET `/login` | 200, точно совпал с build login.html | 200, точно совпал с build login.html |
| Анонимные `/api/config` и `/` | 401; 302 redirect login | 401; 302 redirect login |
| POST `/api/auth` | 200, ok true; HttpOnly/SameSite cookie | 200, ok true; HttpOnly/SameSite cookie |
| Авторизованный `/api/config` | 200, ожидаемый loopback wsUrl | 200, ожидаемый loopback wsUrl |
| `/api/config/workspaces` | 200, defaultWorkspaceId null | 200, defaultWorkspaceId null |
| Авторизованный `/` | 200, 1839 bytes, build совпал | 200, 1839 bytes, build совпал |
| JS `/assets/main-BTtRyw3O.js` | 200, 9779012 bytes, build совпал | 200, 9779012 bytes, build совпал |
| Остановка SIGTERM | exit 0, 2.020 s | exit 0, 2.173 s |
| После остановки | port closed, lock removed, no live group PIDs | port closed, lock removed, no live group PIDs |

SHA256 проверенного HTML: `3fe48f75e2feac47bbb40daffcddd17dad166625aac180559c95c57bb406084b`. API workspace configuration соответствует пустому свежему конфигу на диске. В безопасно отредактированных runtime логах не обнаружены ошибки startup. Принудительная эскалация сигналов не потребовалась. Финальный сервер остановлен.

Это HTTP/asset smoke с авторизацией, а не выполнение UI в браузере и не агентный turn к LLM. Desktop GUI, iOS, native sidecar и внешние messaging/LLM интеграции в эту проверку не входят.

### Воспроизведение runtime smoke

Сохранить следующий код во временный файл вне checkout, например `/tmp/rox-runtime-smoke-repro.py`, и запустить `python3 /tmp/rox-runtime-smoke-repro.py`. Код намеренно отказывается запускаться при занятом порте или уже существующем своём runtime каталоге; не удаляйте неизвестные процессы/конфиги. Для повторного выполнения выберите новый уникальный `BASE` вне checkout. Код обеспечивает cleanup собственных процессов после обоих циклов и не содержит значений токенов.

```python
#!/usr/bin/env python3
"""Local server smoke test; auth secret and cookie exist in memory only."""
import datetime
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

REPO = Path('/workspace/rox-one')
BUN = Path('/workspace/.onboarding-tools/node_modules/.bin/bun')
BASE = Path('/tmp/rox-validation-20260930/runtime')
CONFIG = BASE / 'config'
HOST, PORT = '127.0.0.1', 9100
URL = f'http://{HOST}:{PORT}'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(opener, path, method='GET', data=None, headers=None):
    req = urllib.request.Request(URL + path, data=data, method=method,
                                 headers=headers or {})
    try:
        response = opener.open(req, timeout=5)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        return response.status, response.headers, response.read()


def port_open():
    try:
        with socket.create_connection((HOST, PORT), timeout=0.2):
            return True
    except OSError:
        return False


def group_members(pgid):
    found = []
    for entry in Path('/proc').iterdir():
        if entry.name.isdigit():
            try:
                tail = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
                # state, ppid, pgrp; zombies do not hold live runtime resources.
                if int(tail[2]) == pgid and tail[0] != 'Z':
                    found.append(int(entry.name))
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                pass
    return sorted(found)


def write_safe_log(pipe, path, token):
    with path.open('w', encoding='utf8') as log:
        os.chmod(path, 0o600)
        for line in pipe:
            if 'TOKEN=' in line or 'Set-Cookie' in line or 'Bearer ' in line:
                log.write('[redacted authentication log line]\n')
            else:
                log.write(line.replace(token, '[redacted]'))
        log.flush()


def stop_server(proc, thread):
    started = time.monotonic()
    if proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
    escalated = False
    try:
        code = proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        escalated = True
        os.killpg(proc.pid, signal.SIGKILL)
        code = proc.wait(timeout=5)
    leftovers = group_members(proc.pid)
    if leftovers:
        os.killpg(proc.pid, signal.SIGTERM)
        deadline = time.monotonic() + 5
        while group_members(proc.pid) and time.monotonic() < deadline:
            time.sleep(0.1)
        if group_members(proc.pid):
            escalated = True
            os.killpg(proc.pid, signal.SIGKILL)
    deadline = time.monotonic() + 5
    while port_open() and time.monotonic() < deadline:
        time.sleep(0.1)
    thread.join(timeout=3)
    return {'pid': proc.pid, 'signal': 'SIGTERM', 'exit_code': code,
            'seconds': round(time.monotonic() - started, 3),
            'kill_escalation': escalated,
            'remaining_live_group_pids': group_members(proc.pid),
            'port_closed': not port_open(),
            'server_lock_removed': not (CONFIG / '.server.lock').exists()}


def run_cycle(number):
    token = secrets.token_hex(24)
    child_env = os.environ.copy()
    # Overrides are limited to this subprocess; cloud configuration is untouched.
    for name in ('CRAFT_RPC_TLS_CERT', 'CRAFT_RPC_TLS_KEY', 'CRAFT_RPC_TLS_CA',
                 'CRAFT_WEBUI_PASSWORD', 'CRAFT_WEBUI_SECURE_COOKIE',
                 'CRAFT_WEBUI_WS_URL'):
        child_env.pop(name, None)
    child_env.update({
        'PATH': str(BUN.parent) + os.pathsep + child_env.get('PATH', ''),
        'CRAFT_CONFIG_DIR': str(CONFIG), 'ROX_CONFIG_DIR': str(CONFIG),
        'CRAFT_SERVER_TOKEN': token, 'ROX_SERVER_TOKEN': token,
        'CRAFT_RPC_HOST': HOST, 'CRAFT_RPC_PORT': str(PORT),
        'CRAFT_HEALTH_PORT': '0', 'CRAFT_PRINT_TOKEN': '0',
        'CRAFT_WEBUI_DIR': str(REPO / 'apps/webui/dist'),
        'CRAFT_BUNDLED_ASSETS_ROOT': str(REPO / 'apps/electron'),
        'CRAFT_APP_ROOT': str(REPO / 'apps/electron'),
        'CRAFT_RESOURCES_PATH': str(REPO / 'apps/electron/resources'),
        'CRAFT_BROWSER_BACKEND': 'none', 'CRAFT_DEBUG': 'false',
    })
    proc = subprocess.Popen([str(BUN), 'packages/server/src/index.ts'],
                            cwd=REPO, env=child_env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, start_new_session=True)
    thread = threading.Thread(target=write_safe_log,
                              args=(proc.stdout, BASE / f'cycle-{number}.log', token),
                              daemon=True)
    thread.start()
    started = time.monotonic()
    result = {'cycle': number, 'pid': proc.pid,
              'start_utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        anonymous = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        deadline = started + 45
        while True:
            if proc.poll() is not None:
                raise RuntimeError(f'server exited before readiness: {proc.returncode}')
            try:
                code, _, body = request(anonymous, '/health')
                health = json.loads(body)
                if code == 200 and health.get('status') == 'ok':
                    break
            except (OSError, ValueError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError('health did not become ok within 45 seconds')
            time.sleep(0.25)
        assert health['checks'] and all(c['status'] == 'pass' for c in health['checks'])
        result['health'] = {'status_code': code, 'body': health,
                            'ready_seconds': round(time.monotonic() - started, 3)}
        code, hdr, body = request(anonymous, '/login')
        assert code == 200 and hdr.get('Content-Type', '').startswith('text/html')
        assert b'Rox' in body and b'type="password"' in body and b'/api/auth' in body
        assert body == (REPO / 'apps/webui/dist/login.html').read_bytes()
        result['login'] = {'status_code': code, 'html_matches_built_file': True}
        code, _, body = request(anonymous, '/api/config')
        assert code == 401 and json.loads(body)['error'] == 'Unauthorized'
        result['anonymous_config'] = {'status_code': code}
        code, hdr, _ = request(anonymous, '/')
        assert code == 302 and hdr.get('Location') == '/login'
        result['anonymous_root'] = {'status_code': code, 'location': '/login'}
        jar = http.cookiejar.CookieJar()
        authenticated = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPCookieProcessor(jar))
        code, hdr, body = request(authenticated, '/api/auth', method='POST',
                                  data=json.dumps({'password': token}).encode(),
                                  headers={'Content-Type': 'application/json'})
        assert code == 200 and json.loads(body) == {'ok': True}
        cookie_header = hdr.get('Set-Cookie', '')
        assert len(jar) == 1 and 'HttpOnly' in cookie_header and 'SameSite=' in cookie_header
        result['auth'] = {'status_code': code, 'body': {'ok': True},
                          'session_cookie_present': True, 'http_only': True}
        code, _, body = request(authenticated, '/api/config')
        config = json.loads(body)
        assert code == 200 and config == {'wsUrl': f'ws://{HOST}:{PORT}'}
        result['authenticated_config'] = {'status_code': code, 'body': config}
        code, _, body = request(authenticated, '/api/config/workspaces')
        workspace_config = json.loads(body)
        assert code == 200 and workspace_config == {'defaultWorkspaceId': None}
        result['workspace_config'] = {'status_code': code, 'body': workspace_config}
        code, hdr, body = request(authenticated, '/')
        assert code == 200 and hdr.get('Content-Type', '').startswith('text/html')
        assert b'<title>Rox</title>' in body and b'id="root"' in body
        assert body == (REPO / 'apps/webui/dist/index.html').read_bytes()
        result['webui'] = {'status_code': code, 'bytes': len(body),
                           'html_matches_built_file': True,
                           'sha256': hashlib.sha256(body).hexdigest()}
        asset = re.search(rb'<script[^>]*src="([^"]+)"', body).group(1).decode()
        asset_path = '/' + asset.lstrip('./')
        code, hdr, body = request(authenticated, asset_path)
        assert code == 200 and 'javascript' in hdr.get('Content-Type', '')
        assert body == (REPO / 'apps/webui/dist' / asset_path.lstrip('/')).read_bytes()
        result['javascript_asset'] = {'status_code': code, 'path': asset_path,
                                     'bytes': len(body), 'matches_built_file': True}
        disk_config = json.loads((CONFIG / 'config.json').read_text())
        assert disk_config['workspaces'] == [] and disk_config['activeWorkspaceId'] is None
        result['isolated_config'] = {'path': str(CONFIG), 'workspace_count': 0,
                                     'active_workspace_id': None}
        result['passed'] = True
    except Exception as exc:
        result['passed'] = False
        result['failure'] = f'{type(exc).__name__}: {exc}'.replace(token, '[redacted]')
    finally:
        result['stop'] = stop_server(proc, thread)
    assert result['stop']['port_closed'], 'Server port remained open after stop'
    assert result['stop']['exit_code'] == 0, 'Server did not stop with exit code 0'
    assert not result['stop']['remaining_live_group_pids'], 'Server process group remains'
    return result


def main():
    os.umask(0o077)
    BASE.mkdir(parents=True, exist_ok=False)
    assert not port_open(), 'Refusing to use occupied port'
    results = [run_cycle(1)]
    print(json.dumps(results[0], ensure_ascii=False), flush=True)
    if results[0]['passed']:
        results.append(run_cycle(2))
        print(json.dumps(results[1], ensure_ascii=False), flush=True)
    summary = {'cycles': results, 'all_passed': len(results) == 2 and all(r['passed'] for r in results),
               'final_port_closed': not port_open()}
    (BASE.parent / 'runtime-results.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps({'all_passed': summary['all_passed'],
                      'final_port_closed': summary['final_port_closed']}), flush=True)
    raise SystemExit(0 if summary['all_passed'] else 1)


if __name__ == '__main__':
    main()

```

## Итог и сохранность

Запуск реального headless workflow в текущем cloud экземпляре подтверждён: обе сборки, два функционально проверенных запуска и две штатные остановки выполнены. Сеть прошла live Git/HTTPS проверки. В запрошенных проверках не осталось обнаруженных инфраструктурных блокеров. При этом commit содержит три воспроизводимых тестовых дефекта и 52 + 8 диагностик типов; тесты/typechecks не считаются прошедшими.

`git status --porcelain=v1 --untracked-files=all` пустой до и после; `git diff --exit-code` успешен. Единственный постоянный новый артефакт — этот отчёт вне checkout. Временные скрипты, логи и отдельный тестовый конфиг удалены после включения доказательств и кода в отчёт. Штатные игнорируемые build outputs обновлены запрошенными сборками. Настройки среды, allowlist, секреты, исходники и lockfile не изменялись; инструменты записи черновика конфигурации не вызывались.

Время завершения отчёта: 2026-09-30T14:12:01+03:00 (Europe/Moscow).
