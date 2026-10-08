# Rox: аудит Windows-рантайма, MCP и установки

Дата: 3 октября 2026 года. Репозиторий: `rox-one`.
Рабочая ветка: `fix/windows-runtime-mcp-bootstrap-20261003`.
Исходный HEAD: `ab03c1c762654daa9a94585767017a5e2244e174`.

## Основной вывод

Основной OMP/MCP/Python-рантайм поддерживает нативную Windows. Перенос всего
приложения в WSL не требуется. Подтверждённые причины отказов — запуск `.cmd`
как исполняемого файла из Node, преобразование переносимых путей, неверные
каталоги и неполная упаковка зависимостей. WSL имеет смысл для конкретных
Linux-only сценариев; его установка теперь предусмотрена отдельно в установщике.

Исправления находятся в исходниках новой ветки. Запущенная установленная версия
Rox 0.11.5 использует старый `resources/app/dist/main.cjs`: изменение checkout
само по себе её не обновляет. Производственная сборка требует настоящего
Windows OEM kernel payload, отсутствующего в исходной поставке и установленном
приложении. Отдельные внешние сервисы требуют восстановления сервера/авторизации.

## Проверенная среда и границы проверки

- Запущен `Rox.exe` из `%LOCALAPPDATA%\Programs\@craft-agentelectron`.
- Данные приложения находятся в `%USERPROFILE%\.rox`; активный workspace —
  `.rox/workspaces/my-workspace`.
- Изучены исходники, установленные bundle/launcher, безопасные поля конфигурации,
  `main.log`, managed toolchain и метаданные OMP.
- Использованы 12 независимых агентных направлений: OMP, sources, toolchain,
  installer, MCP pool, paths, инвентаризация, host Bash, startup integration,
  MCP lifecycle, source health/migration, независимое ревью. Дополнительные
  проверки компиляции и повторные проходы устраняли найденные дефекты.
- Тестовые установки выполнялись в отдельных временных каталогах. Пароли,
  токены и содержимое личных заметок в отчёт не включены.
- Источники Exa/Firecrawl выключены: наличие записей не означает, что их
  подключения проверены или API-ключи настроены.

## Подробный перечень дефектов

| № | Подтверждение | Причина и влияние | Исправление / состояние |
|---|---|---|---|
| 1 | `main.log:762,1009`: `runMiniCompletion failed: spawn EINVAL`; чат также не даёт ответа после spawn | Node/Electron напрямую запускает `omp.cmd` | OMP RPC и one-shot запускают native Bun + JS entrypoint, literal argv, `shell:false`; проверены оба пути |
| 2 | Managed OMP 17.2.10 требует Bun >=1.3.14; оба bundled Bun — 1.3.9 | Установщик и release-скрипт используют разные pins | Общая подготовка release/beforePack; Bun 1.3.14 и uv 0.12.2 |
| 3 | `main.log:720,967`: `<cwd>\~\.rox\...` | Повторное `toPortablePath()` меняет `~/` на `~\`; expand не узнаёт legacy вид | Идемпотентные portable paths, поддержка обоих разделителей, Windows/UNC/drive проверки |
| 4 | `main.log:757,1004` считает восемь local sources failed builds | Локальные папки не создают MCP/API серверов, но учитываются как неудачные серверы | SourceManager отдельно проверяет доступный каталог, сообщает folder unavailable и даёт файловые инструкции |
| 5 | `applications` указывает на отсутствующий `~/Applications` | macOS default на Windows | Windows Start Menu Programs; ограниченная миграция точного старого auto-default при отсутствии старого и наличии нового каталога |
| 6 | `telegram-support` указывает на отсутствующий `~/Library/Application Support/Telegram` | macOS default на Windows | `%APPDATA%\Telegram Desktop`, аналогичная миграция; источник остаётся папкой, а не Telegram API |
| 7 | Docs MCP в `main.log:771,1012`; прямой initialize POST возвращает HTTP 500 с пустым телом | Внешний endpoint `https://agents.craft.do/docs/mcp` неисправен | Добавлена диагностика transport/status/source; серверное восстановление ещё требуется |
| 8 | SDK stdio имеет cross-spawn, но путь runtime не попадает в MCP child PATH | Managed npm/npx/uvx недоступны части дочерних процессов; конфликт `PATH`/`Path` | Единое case-insensitive PATH prefixing и bootstrap runtime integration; реальные stdio handshake |
| 9 | `cwd` source server-builder не передавался client transport | MCP относительные файлы открываются в другом каталоге | `cwd` проходит в `StdioClientTransport`; проверка реальным subprocess |
| 10 | Hanging SSE transport оставляет соединение pending и сокет открытым после close | SDK request timeout не покрывает `transport.start()` | Общий 30-секундный deadline startup/initialize/health; abort/close ожидает cleanup, concurrent connect объединён |
| 11 | HTTP-only client не работал с legacy SSE endpoint | Несовместимость протокола | Ограниченный fallback при initialize HTTP 400/404/405; 401/403/429/500 и discovery failures не скрываются |
| 12 | Public/local sources читают credential vault без необходимости | Неверное auth gating | Local/stdio/public источники обходят ненужное чтение; явные config errors и headers/auth учитываются |
| 13 | uv 0.12.2 Windows ZIP содержит `uv.exe`/`uvx.exe` в корне | Manifest ищет несуществующий вложенный каталог | Windows binPaths исправлены; uvx и npm aliases добавлены |
| 14 | `spawn npm.cmd` под plain Node воспроизводит EINVAL | npm install использует batch launcher | Native Node + npm-cli.js без shell; argv injection regressions |
| 15 | Python junction ведёт относительно host cwd | Неправильная Windows junction target | Абсолютный CPython target; uv install без user launcher/registry/config изменений |
| 16 | Resolver принимает каталоги, теряет quoted PATH, неверно подбирает companion | Команды определяются ненадёжно | Регулярные executable files, Windows suffixes, корректный python3, generated launchers |
| 17 | Broken generated gbrain/pip installation остаётся ready при отсутствии bin | `.every([])` даёт true | Проверка ожидаемого launcher в version/current; repair incomplete installs |
| 18 | FFmpeg pinned Windows URL возвращает 404 | Удалённый artifact | Проверенный BtbN Windows 9.0.2 LGPL pin, SHA256/size; ffmpeg не critical для chat |
| 19 | Git Bash установлен, но отсутствует в PATH | Native Bash selection ошибочно считает его отсутствующим | Явный override, Git/common paths, исключение System32 WSL launcher; PortableGit provisioning |
| 20 | Bash timeout оставляет descendants/pipe открытыми | MSYS PID race, taskkill snapshot, ожидание close после shell exit | Native usr/bin/bash, bounded tree cleanup с повторным обнаружением descendants и освобождением pipes |
| 21 | NSIS one-click не устанавливал CLI prerequisites | Первый запуск зависит от случайного host окружения | Assisted installer, private gh/MinGit/Node/jq/yq payloads, bootstrap receipt, repair/idempotence |
| 22 | Installer receipt сначала не использовался рантаймом | CLI установлены в отдельный cache, но child PATH их не видит | Startup читает/валидирует receipt до MCP/backend; перепроверяет executable, не доверяет pathEntries |
| 23 | Windows main bundler не исключает native onnx/sharp | Отдельный build-win.ps1 расходится с canonical build | Release делегирован общему main builder; main bundle компилируется |
| 24 | WorkGraph динамически требует Turso driver; Windows extraResources его не копирует | Установленный bundle не содержит database facade/common/NAPI | Все три Windows пакета добавлены; проверена in-memory SQL в изолированном package |
| 25 | SDK cross-fetch вставляет `C:\Users\...` в JS literal | `\u` invalid Unicode escape, апострофы ломают expression | UTF-8 JSON read без интерполяции пути в JavaScript |
| 26 | Launcher `.cmd` записывает абсолютный Unicode profile path как ASCII | `Иван` превращается в `????` | Literal `%LOCALAPPDATA%`, реальный Unicode fixture |
| 27 | OEM kernel staging содержит README, не executable | Knowledge/OEM модуль фактически не поставлен | Production gate проверяет Windows x64 PE и stage/appearance; dev omission явно маркируется |
| 28 | Shared/Electron typecheck содержит baseline errors | Несогласованные unions/nullability/navigation/byte buffers | Устранены минимальными contract/type corrections, существующие проверки сохранены |
| 29 | Повторный builder → pool → real child probe теряет cwd | Pool преобразование не учитывает cwd даже после client fix | cwd forwarding и cwd-only reconnection, проверка через полный builder/pool путь |
| 30 | MCP child выходит, pool продолжает connected=true | Map membership подменяет liveness | Закрытые клиенты исключаются из tools/health; sync/ensureConnected заменяют их, failed calls не replay |
| 31 | Host Bash не видит managed Pandoc и выбирает WindowsApps Python | Host registry исполняется в parent, не OMP subprocess | Environment callback, managed/bootstrap prefix, ORIGINAL_PATH для Git login profile, managed python3 |
| 32 | Upgrade launcher ищет Programs/Rox вместо legacy install directory | NSIS сохраняет registered InstallLocation | UTF-8 PowerShell helper читает фактический NSIS location, проверяет путь и сохраняет literal argv |

### Источники активного workspace

| Источник | Что реально подключается | Проверка / дальнейшее действие |
|---|---|---|
| notes | `%USERPROFILE%\rox\notes` | Каталог существует; ложный failed-build исправлен |
| memory | `%USERPROFILE%\rox\memory` | Каталог существует; ложный failed-build исправлен |
| sessions | `%USERPROFILE%\rox\sessions` | Каталог существует; это imported/archive folder, не live `.rox/.../sessions` |
| tasks | `.rox/workspaces/my-workspace/tasks` | Каталог существует |
| projects | `.rox/workspaces/my-workspace/projects` | Каталог существует |
| workspace-tree | `.rox/workspaces/my-workspace` | Каталог существует |
| applications | Старый macOS default отсутствует | Миграция после загрузки новой версии при точном legacy default |
| telegram-support | Старый macOS default отсутствует | Миграция на проверенную Windows папку при точном legacy default |
| craft-agents-docs | Remote HTTP MCP | HTTP 500; внешнее исправление необходимо |
| exa | API source, disabled, needs_auth | Настроить credential штатным flow при включении |
| firecrawl | API source, disabled, needs_auth | Настроить credential штатным flow при включении |

Stored `connected` не является результатом теста: у folder-source записей
`lastTestedAt` не задан. Локальные источники не должны выдавать себя за MCP.

## Инструменты: установленное и необходимое

| Инструмент | Исходная машина | Что предусмотрено |
|---|---|---|
| Bun | System/managed 1.3.14; bundled 1.3.9 | Bundled 1.3.14, проверенная загрузка |
| OMP | Rox-managed 17.2.10; отдельно global 17.3.3 | Использовать выбранный managed runtime, не смешивать версии |
| Node/npm/npx | System Node 22.23.1; managed 22.23.2 | Pinned Node 22.23.2 и companions; minimum system Node 22.23 |
| uv/uvx | System 0.11.30; bundled 0.10.6; managed 0.12.2 | Bundled/managed 0.12.2, корректные binPaths |
| Python/python3 | Shell WindowsApps aliases exit 9009; managed 3.12.13 работает | Managed Python >=3.12; aliases не считать полноценным интерпретатором |
| Git | Full system Git 2.55.0; managed MinGit | MinGit для native Git и отдельно PortableGit для Bash |
| Git Bash | 5.3.15, работает по absolute path, не найден bare bash | Installer Git Bash option; native discovery/override |
| gh | Shell отсутствует; managed 2.97.0 работает | Установка gh 2.97.0, PATH для дочерних процессов; gh auth отдельно |
| jq/yq | Нет bare commands; managed utilities | Private bootstrap jq 1.8.1/yq 4.53.3 |
| rg | System 15.2.0; bundled executable работает | Обязательная build staging и resource PATH |
| FFmpeg | System 8.1.2; managed download404 | Verified Windows 9.0.2 payload, медиа-функции optional относительно chat |
| Pandoc | Core toolchain catalog | Документные сценарии; наличие/версия проверяются manager |
| PowerShell 5.1/tar | Inbox Windows доступны | Достаточно для native bootstrap; PowerShell 7 не prerequisite |
| WSL | Optional component отсутствует; status exit50/list exit1 | Опциональный install-time WSL2 + Ubuntu, без auto reboot |
| Docker | CLI/engine не обнаружены | Отдельная feature-specific установка engine; WSL сам по себе его не предоставляет |

Core catalog дополнительно содержит pandoc; default-on disableable helpers:
`just`, `fzf`, `mise`, `worktrunk`, `opencode-ai`, `oh-my-codex`,
`oh-my-claude-sisyphus`, `skills`, `gbrain`.
Windows opt-in helpers: `infisical`, `openclaw`, `eve`, `agent-browser`,
`portless`, `just-bash`, `opensrc`, `deepsec`, `dev3000`, `docker`,
`pip-packaging`, `cli-anything`. Их не следует считать prerequisites чата.
`brew`, `mole`, `craft-native` не имеют native Windows artifacts.
WSL не делает macOS-only навыки работоспособными.

Python document scripts объявляют зависимости через uv. Отсутствие python-docx,
openpyxl/Pillow/MarkItDown в base CPython не доказывает отсутствие uv script env.
Полная функциональная проверка конвертации каждого формата — отдельный acceptance
пункт; голая переустановка всех Python пакетов в global site-packages не нужна.

## План и реализация

1. Найти процесс и checkout, проверить git cleanliness, создать новую ветку.
   Выполнено; исходная ветка `win10-win11-final-build` сохранена.
2. Инвентаризировать actual executables, configs, logs; разделить native sources,
   MCP/API, внешние ошибки и отсутствие зависимостей. Выполнено.
3. Исправить OMP argv-spawn, paths, source health/auth/stdio cwd/PATH и bounded
   MCP lifecycle. Выполнено, добавлены реальными процессами проверяемые regressions.
4. Исправить toolchain downloads/install/resolver/repair и Bash tree cleanup.
   Выполнено; pins сверены с реальными скачанными Windows artifacts.
5. Обеспечить installer → runtime prerequisites, native Git Bash, optional WSL.
   Выполнено: receipt reader, modes, startup integration, SHA256/size payloads.
6. Проверить независимым ревью release-path consistency и native extraResources.
   Выполнено; найденные дефекты canonical Windows build/WorkGraph исправлены.
7. Очистить compile blockers и повторить regression/typecheck/build verification.
   Проверки и результаты ниже; production acceptance ограничена vendor payload.
8. Для production передать настоящий OEM Windows payload, собрать installer,
   выполнить clean-machine install/upgrade и живой chat/MCP smoke.
   Этот этап зависит от отсутствующей поставки kernel; он не подменяется README.

## Установщик и WSL

Подробный контракт: [Windows bootstrap](../apps/electron/build/windows/README.md).

- Native CLI пакеты поставляются offline в installer, SHA256 и size обязательны.
- `auto` предпочитает рабочие system executables; `bundled` — pinned private
  варианты; `system` сообщает отсутствующие prerequisites без скрытого fallback.
- User `toolchain.dependencyMode` имеет приоритет над installer default.
- Receipt — не доверенный resolver: пути/pins/regular files/reparse points и
  executable versions перепроверяются. Global/user PATH не перезаписывается.
- WSL отдельно выбирается в installer; OS features запускаются через UAC с
  `/NoRestart`, возврат 3010 сохраняется, automatic reboot отсутствует.
- Ubuntu регистрируется в контексте исходного пользователя; WSL1 не конвертируется
  молча. First-user setup и feature-specific Linux helpers должны быть завершены
  внутри Ubuntu. Windows gh/node не являются Linux gh/node.
- Linux support не устанавливается автоматически при startup/update.

## Проверки и воспроизведение

Команды выполняются из корня репозитория в PowerShell:

```powershell
bun test packages/shared/src/toolchain packages/shared/src/mcp/__tests__ packages/shared/src/sources packages/shared/src/utils/paths.test.ts packages/shared/src/sessions/__tests__/storage-paths.test.ts packages/shared/src/agent/core/__tests__/source-manager.test.ts scripts/build/__tests__ apps/electron/src/main/__tests__/windows-bootstrap.test.ts
bun run typecheck:shared
bun run typecheck:electron
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-bootstrap.ps1 -TempRoot "$env:TEMP\opencode"
bun scripts/test-windows-nsis.ts --temp-root "$env:TEMP\opencode" --download
```

На финальном объединённом запуске core/bootstrap/source/MCP/path/build tests:
**488 pass, 1 skip, 0 fail, 2637 assertions, 51 файл**.
Пропущена POSIX permission проверка, неприменимая к Windows.
Shared и Electron typecheck проходят после contract corrections.
Отдельно проверены native Node OMP RPC/one-shot, literal special-character argv,
настоящий MCP initialize/tools/call, TCP disconnect/child cleanup, real pinned
bootstrap CLI installs/reuse, Unicode profile launcher, WorkGraph SQL.

Host Bash combined run первоначально воспроизвёл timeout regression. Исправлена
MSYS process-tree race. Финальные раздельные OMP и host-runtime/Bash наборы дали
46/0 и 32/0 соответственно (78 tests суммарно).
Дополнительно устранены недетерминированные deadline-phase assertions MCP
фикстуры и late bare-node lookup при временной смене PATH соседним тестом.
Проверки реальных socket/child cleanup сохранены. При смешивании всех этих suites
в один Bun process остаются интермиттирующие fixture startup deadlines: один
последующий проход дал 78/0, другой — 77/1 по OMP deadline. Это не выдаётся за
детерминированно зелёный combined suite. Старые failed/timed-out runs не
засчитываются как runtime acceptance; финальные изолированные результаты указаны отдельно.

Production команда `bun run dist:win` должна блокироваться при отсутствующем OEM
payload. Development-only сборка явно допускается так:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/electron/scripts/build-win.ps1 -DevWithoutOemKernel -SkipDependencyInstall
```

Она не является полноценным production installer: Knowledge/OEM функциональность
не поставляется без vendor payload. Статус полной сборки и финальной верификации
зафиксирован в [итоговом журнале](2026-10-03-rox-windows-verification.md).

## Что требует внешнего завершения

1. Восстановить docs MCP endpoint: подтверждённый HTTP 500 не устраняется клиентским
   fallback и не должен отображаться как connected.
2. Подтвердить действующую OMP авторизацию. В исторических OMP logs есть
   `401 invalid_api_key`, 503 и timeouts; наличие token field не означает валидность.
3. Настроить gh auth и API credentials для реально включаемых integrations.
4. Поставить настоящий OEM Windows x64 binary + stage/appearance и завершить
   production installation acceptance на Win10/Win11/clean VM.
5. Внешний updater старой установленной версии запрашивает Craft Agents artifacts;
   в логе blockmap404 и fallback download стороннего upstream 0.14.0. Проверить
   release hosting/канал Rox перед распространением обновления.

Секреты и live workspace configs не переписывались. Применение source migration
происходит штатным загрузчиком после запуска исправленной версии; текущий процесс
Rox сам по себе не становится новой сборкой.
