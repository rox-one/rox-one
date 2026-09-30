# Автономный запуск и восстановление compound-программы

**Статус:** выбрано автономно. Программа остаётся активной; этот ADR не закрывает пакеты.

## Параллельные исполнители

Для подготовки независимых пакетов используется настоящий установленный OMP CLI с `openai-codex/gpt-6.1-sol` и `--thinking high`. Запущены 70 отдельных процессов и получены 70 native session IDs. Встроенная команда агентов сохраняет владение интеграцией и приёмкой. Первое задание внешнего пула — изучение исходников с единственным разрешённым выходным JSON для каждого пакета. Зависимые реализации запускаются после принятия зависимостей, а независимая волна 1 — после коммита волны 0.

Каждый отчёт содержит dispatch lineage, исходную ревизию и хеши изученных файлов. Изменение общего файла делает его свидетельство устаревшим. Такой отчёт сохраняется; перед реализацией соответствующий seam перечитывается. Публикация отчёта и наличие session ID не являются реализацией функции. Настоящие receipts находятся в `plans/compound-implementation/external-workers.json`.

Это локальные исполнители. Cloud coding executor пока не provisioned; локальные сессии не называются облачным запуском.

## Единая запись Markdown

Save, create, rename, delete, daily note и Markdown backlinks используют один WAL/CAS writer. Изменения нескольких заметок и папок сериализуются vault lease; обычная запись также имеет physical-file lease. Claim публикуется из синхронизированного owner record. Восстановление требует смерти владельца процесса; задержка, timeout или SIGSTOP права перехвата не дают.

Native invalidation имеет стабильный event ID и состояние pending/accepted. Accepted означает возврат локального callback. Это не ACK клиента или удалённого пользователя. Повтор после сбоя разрешён с тем же event ID. Запрос receipt не требует работоспособности invalidation callback и сохраняет pending intent.

После durable публикации недоступный callback, смена source или отзыв окна возвращают `DOCUMENT_RESULT_UNAVAILABLE`: запись могла произойти, поэтому клиент сохраняет draft и operation ID. Следующий read или receipt при отозванном доступе возвращает `AUTH_FAILED`; source fence проверяется заново. До публикации denial не превращается в ambiguous success. Эта семантика сохраняет исходные source-boundary tests и не сообщает сохранение, которого не было.

Legacy read и lookup отсутствующего receipt не создают metadata. Произвольный внешний редактор не участвует в ROX lease; OS-level CAS против некооперирующего процесса не заявляется.

## Свойства и виды заметки

Scalar property меняется по retained source span с сохранением типа. Неизменённые `null`, `"001"`, `"true"`, `"a,b"` не преобразуются по отображаемому тексту. Создание header или структурная конверсия требует явного preview До/После; pending draft очищается только после native ACK. Map и Outline проецируют одну committed Markdown tree; стабильные anchors вставляются отдельной проверенной командой, не скрытым rewrite при чтении.

## Projects и CI

Project list использует `LoadedProject[]`; облегчённые session-picker options остаются отдельной проекцией существующей модели. Новый store не создаётся. Source capture использует REVIEW → BIND → CAPTURE и durable policy в существующем ProjectConfig. Current policy проверяется и для исторических immutable snapshots. CI source не отправляется в LLM или внешнему провайдеру под локальным read-only разрешением.

## Локализация

Код содержит 12 действующих locale catalogs. Новые ключи добавлены во все 12 с одинаковой ASCII сортировкой. RU/EN написаны явно; для остальных языков этой волны используются EN значения до их перевода. Русский остаётся языком пользовательской приёмки. Порог проверки и существующие test assertions не понижаются.

## Исправления native integration и запуск следующей волны

Проверка настоящего Electron выявила, что Tiptap default update при `setEditable` и `setContent` помечал неизменённый документ dirty. Повторные own-write filesystem события принимались за external и переоткрывали заметку. Выбрано автономно: silent host/authority sync, сравнение exact content echo, сохранение собственного watcher version до реального изменения mtime. Native rerun обязателен; старый FAIL receipt сохраняется.

Восстановимый checkpoint фиксирует реализованный механизм и фактические scoped проверки, сохраняя неполный DoD. Семь независимых пакетов с пустыми explicit dependencies запускаются после этого коммита; это не закрывает недостающие критерии wave0. Зависимые пакеты остаются заблокированы принятием своих зависимостей. Final comprehensive acceptance проводится после реализации всей программы.

Для WP-01 provisioned отдельная PostgreSQL 17.11: только loopback, SCRAM для TCP, закрытый Unix socket directory и protected credentials вне репозитория. Реальная Bun.SQL транзакция с временной таблицей прошла. Глобальный PostgreSQL login service не включён; существующие базы не использованы.

Native CAS test подтвердил, что backend возвращает `HASH_CONFLICT`, но contextBridge удаляет custom Error properties. Это соответствует [официальному контракту Electron](https://www.electronjs.org/docs/latest/api/context-bridge). Выбрано автономно: существующий `buildClientApi` передаёт validated coded rejection как обычный cloneable объект `{code,message,data?}`; некодированные ошибки сохраняют прежнюю семантику. Отдельный native probe подтвердил перенос code у plain object; реальный application recovery проверяется последующим прогоном.
