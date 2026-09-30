# Проверки первого среза UTB-01

**Дата:** 30.09.2026. **Baseline:** `f63294ba4fffa7238b46b24e918925a313ad0b12`. **Ветка:** `feat/unified-tables-baserow-20260930`. **Задача:** #1296, общий epic #1295.

## Выполнено

| Проверка | Фактический результат | Что это доказывает |
|---|---|---|
| Первоначальный RED | 52 теста: 10 pass, 42 fail на незавершённой реализации | Тесты отвергают отсутствие version/default, непроверенные payload и разрешение всех действий |
| Первый GREEN | 52/52 pass | Базовое поведение нового core-модуля |
| Дополнительный regression RED | 54 теста: 53 pass, 1 fail | Explicit null mode ошибочно считался отсутствующим из-за nullish coalescing |
| Исправленный итоговый GREEN | 54/54 pass; 0 failed, 0 skipped | Explicit null отклонён, граница UTF-8 размера проверена |
| Isolated strict TypeScript | PASS, TypeScript 5.8.3; 0 diagnostics после исправления двух test-only string-index diagnostics | Типы новых файлов/тестов с точным выделенным Rox2EntityRef boundary fixture; НЕ весь репозиторий |
| Namespace-loss mutation | 1 semantic test failed | Source identity не может потерять accountNamespace |
| Grant-bypass mutation | 4 semantic tests failed | Runtime capability не заменяет grant |
| Silent-rows-drop mutation | 6 semantic tests failed | Неизвестные v1/rows properties отвергаются, не игнорируются |
| package.json preimage | Git blob `a6ba3112dd3bdd464ca6612e2efda06706db9879` совпал с baseline | Восстановлен точный original файл, добавляется только `./bases` export |

## Команда unit tests

```sh
node --experimental-strip-types --test packages/core/src/bases/__tests__/*.test.ts
```

Node v22.16.0. Последний зафиксированный прогон перед публикацией: 54 tests, pass 54, fail 0, skipped 0; elapsed около 0.2 секунды. Это длительность unit suite в данной среде, не benchmark таблицы/пользовательского интерфейса. Node печатает стандартное предупреждение об experimental type stripping; оно не скрывается как прошедший production runner.

Мутации выполнялись на отдельных копиях точных новых файлов. Каждый mutant завершился exit=1 с ERR_ASSERTION. Исходная реализация не менялась во время mutant runs. Все три результата — пойманные semantic defects, не отсутствие runner/dependencies. Повторяющие примерные строки ключи, namespace и allow/deny assertions находятся в тестах и воспроизводятся по изменению соответствующей строки.

## Границы typecheck

В контейнере доступен TypeScript 5.8.3, но отсутствует полный installed monorepo. Проверен отдельный temporary project с strict/noUncheckedIndexedAccess/verbatimModuleSyntax, реальными новыми файлами и тестами; `Rox2EntityRef` взят как точное type-only declaration из прочитанного baseline. Этот boundary fixture не публикуется вместо оригинального файла и не изменяет canonical entity model. Не заявляется проверка всего platform-contract.ts, shared/server/renderer graph или версии компилятора в проектном Bun lockfile.

Первый isolated compile обнаружил два TS7053 в тесте из-за `string[]` при индексации TableCapabilities. Literal tuple `as const` исправил test typing без изменения assertions. Второй compile завершился успешно. Эти первоначальные ошибки не замалчиваются и не выдаются за ошибку существующего main.

## Не выполнено / блокировано

| Lane | Статус | Конкретная причина |
|---|---|---|
| `bun test` полного проекта | BLOCKED | Bun отсутствует; попытка дала exit 127 (`command not found`); локального полного checkout нет |
| Full core/shared/server/renderer typechecks | NOT_RUN | Нет полного checkout и зависимостей; isolated check не является заменой |
| Native Electron/WebUI | NOT_RUN | Нет приложения и подключённого online desktop для UI запуска |
| Persistent Base CRUD / two-client/restart | NOT_RUN | Этот PR не реализует storage/renderer integrations |
| Mail/HTTP/Slack/AI live effects | NOT_RUN | Первый срез не подключает providers и не отправляет ничего наружу |
| Full parity/performance/security release gate | NOT_RUN | Принимается в #1312 после реализации зависимостей |
| Independent code review | NOT_RUN | Самопроверка выполнена; независимого reviewer run в текущем окружении нет |

Git clone через контейнер действительно завершался ошибкой разрешения github.com. Репозиторий читался и изменялся через authenticated GitHub connector; локальная папка — изолированный bundle изменённых файлов, не полный clone/worktree. Две найденные пользовательские desktop-машины были offline. Пользовательские исходники на них не изменялись.

## До merge

Integration owner выполняет frozen install по правилам репозитория, native Bun tests и downstream typechecks на exact PR head, проверяет package export и source seam. Затем независимый review. Этот PR не включает UI флаг, не меняет main и не закрывает полный epic. Только после соответствующих future implementation commits можно проверять создание таблиц в Notes/Docs и реальные workflow/provider результаты.
