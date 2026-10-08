# Rox Windows: итоговый журнал верификации

Ветка: `fix/windows-runtime-mcp-bootstrap-20261003`.
Основной аудит и план: [runtime report](2026-10-03-rox-windows-runtime-report.md).

## Итог

Код рантайма, интеграция зависимостей и Windows development packaging проверены.
Производственная поставка полностью не закрыта: отсутствует OEM Windows payload,
а внешний docs MCP отвечает HTTP 500. Собранный EXE является development-only;
его нельзя объявлять полноценным production installer или уже установленным
обновлением запущенного Rox.

## Финальная тестовая матрица

| Проверка | Результат | Граница доказательства |
|---|---|---|
| Core toolchain/MCP/sources/paths/bootstrap/build | 488 pass, 1 skip, 0 fail; 2637 assertions; 51 файл | Native Windows Bun, реальные stdio/TCP/subprocess fixtures |
| OMP regression | 46 pass, 0 fail; 6 файлов | Финальный отдельный запуск RPC/one-shot/native Node |
| Host Bash + runtime regression | 32 pass, 0 fail; 3 файла | Финальный отдельный запуск factory → registry managed environment/child cleanup |
| MCP/toolchain/OMP/Bash под умеренной CPU-нагрузкой | 306 pass, 1 skip, 0 fail, два прохода | Explicit HTTP response handshakes и настоящие lifecycle cleanup tests |
| Shared typecheck | Exit 0 | `node ../../node_modules/typescript/bin/tsc --noEmit --pretty false` в `packages/shared` |
| Electron typecheck | Exit 0 | Та же команда в `apps/electron` |
| Session tools typecheck | Passed | Отдельно выполнено владельцем host-tool изменений |
| Windows PowerShell bootstrap/launcher | 59 checks passed | Реальные fixture extraction/receipt/argv; WSL/UAC/reboot ветви mocked |
| NSIS include + полный NSIS development target | Passed | Настоящий EXE и blockmap созданы, установщик не запускался |
| Main/workers/preload/renderer/resources | Build passed | Сборка desktop приложения; baseline duplicate-case/import-meta warnings сохранены |
| Пакет WorkGraph | Passed | Реальная native Turso NAPI in-memory SQL |
| Финальный package verifier | PASS | Main syntax/runtime paths, 6 payload SHA256/size, Bun/uv versions, WorkGraph SQL |
| Independent targeted review | Четыре последних code defects закрыты | Повторены actual builder/pool и host handler reproductions |
| Embedded-main freshness | Passed после финальной пересборки | Installer-extracted main byte-identical с rebuilt/unpacked main |
| Git whitespace | Exit 0 | `git diff --check`; LF/CRLF notices не являются failed checks |

POSIX permission test намеренно skipped на Windows.
Корневой полный `bun test` не используется как результат этой работы: проверялись
целевые пакеты и существующие test suites областей, затронутых compile corrections.

Во время исследования были отрицательные проверки: прежний host timeout,
недетерминированные MCP phase assertions и late node PATH lookup. Они устранены
отдельными regressions. Некоторые большие Bun-wrapped typecheck/build calls
превысили terminal budget; они не объявлены успешными. Финальная прямая проверка
TypeScript под Node и завершённая NSIS сборка подтверждены отдельно.

Смешанный OMP/host-runtime/Bash запуск всё ещё интермиттирующий: финальный проход
агента дал 78/0, предшествующий — 77/1 (OMP NDJSON fixture deadline). Host fixture
переведён на async native spawning с сохранением исходных deadlines; прямые
реальные runtime проверки и финальные раздельные suites проходят. Общая причина
Bun inter-suite timing не объявляется доказанной, combined suite не называется
стабильным. Это ограничение тестового harness зафиксировано для последующего CI.

## Артефакт

Путь относительно корня проекта:

```text
apps/electron/release/Rox-development-x64.exe
```

- Версия приложения: `0.11.5`.
- Режим: unsigned, `roxWindowsBuild: optional-development`.
- Размер: **392476536 bytes** (~374.3 MiB).
- SHA256: `f2a418ae03cee70b09013fd85949dec3722313e971ee06d56507e507ba95c251`.
- Main SHA256: `2e9da19ff37cda30e6b2f43610c3c4100233857b62b7d74f8c376a5062a55664`.

Финальный main содержит не только callback/proxy wiring, но и действительное
присваивание `ORIGINAL_PATH` внутри `createHostBashEnv` после подготовки managed
PATH. Предыдущий installer hash `44e80648...` относится к промежуточной сборке
и больше не является итоговым артефактом.

Проверить:

```powershell
bun scripts/verify-windows-release.ts apps/electron/release/win-unpacked apps/electron/release/Rox-development-x64.exe
```

Подробный packaging журнал:
[VALIDATION-20261003](../apps/electron/build/windows/VALIDATION-20261003.md).

## Оставшиеся acceptance-пункты

| Пункт | Почему не закрыт | Конкретный следующий шаг |
|---|---|---|
| Production OEM | Исходная/installed поставка содержит только README | Передать реальный Windows x64 kernel + stage/appearance через `OEM_KERNEL_PAYLOAD_DIR/win32-x64`, затем production build |
| Docs MCP | initialize POST возвращает HTTP500 | Восстановить endpoint на сервере и выполнить initialize/tools/list снова |
| Live LLM authorization | Исторические logs содержат invalid_api_key; токен не обновлялся | Штатная проверка/обновление авторизации и реальный chat/mini-completion |
| Installed Rox upgrade | Работа выполнена в checkout, старый процесс продолжает использовать прежний bundle | После получения production payload выполнить installation/upgrade и живой app smoke |
| Реальная WSL/UAC/reboot цепочка | Нужны OS feature changes/перезагрузка | Disposable Win10/Win11 VM: selected WSL path, 3010, resume, Ubuntu first-user setup |
| API/GitHub auth | CLI installation не является authentication | Настроить включаемые integrations штатным credential flow |

Готовый installer и `Rox.exe` из нового package в этой сессии не запускались.
Ни elevated WSL install, ни reboot не выполнялись. Пользовательские credentials
и workspace records не изменялись. CLI payload smoke installs выполнены в
изолированных временных profiles.

Изменения остаются в рабочем дереве указанной новой ветки; commit/push не
выполнялись. Generated installers/payload binaries не добавлялись в git.
