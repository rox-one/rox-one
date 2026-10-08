# Golden Gate: фактическая проверка

Дата: 2026-09-14. Исходная база аудита: 22c8b89858f8c41d3f687f13d49a31b55045c146.
Продолжение интегрировано с main на 32f239b1cef02e80713984e80ebd43f4625498cb. Проверки ниже относятся к исходникам обновления [PR #584](https://github.com/rox-one/rox-one/pull/584); документация обновлена после выполнения команд.

## Результат

**1748 уникальных тестов прошли, 0 упали, 288 тестовых файлов.** Это выбранные регрессии, модели, SSR, wiring и handler fixtures; все тесты монорепозитория не запускались. Пересечения между наборами исключены при подсчёте: каждый файл учитывается один раз, результаты повторных запусков совпадают. Точные пути, команды, результаты по файлам и SHA-256 логов сохранены в [VERIFICATION-RUNS.json](VERIFICATION-RUNS.json).

| Набор | PASS / FAIL | Файлы |
|---|---:|---:|
| Оболочка, платформа, атомы, навигация и предпочтения | 486 / 0 | 93 |
| Геометрия, статусы/предложения, native ownership, диагностика и actions | 79 / 0 | 13 |
| Settings, collection, темы, общие controls и Markdown | 311 / 0 | 65 |
| Notes: данные, черновики, фокус и доступность | 64 / 0 | 13 |
| Composer/input и диктовка | 83 / 0 | 11 |
| Tasks/Meetings: presentation, запросы и deep links | 75 / 0 | 16 |
| Типовые контракты и входящие изменения main | 618 / 0 | 89 |
| Изолированные workspace guards настоящих RPC handlers | 3 / 0 | 1 |
| Локализация | 113 / 0 | 5 |

Строки таблицы частично пересекаются; их простая сумма не является количеством уникальных тестов.

| Дополнительная проверка | Фактический результат |
|---|---|
| typecheck:all | PASS: core, shared, server-core, server, session-tools-core, pi-agent-server, Electron, UI. Отсутствующий workers/pages штатно пропущен существующим скриптом. |
| Финальный Electron tsc после переноса resize handles | PASS. |
| validate:dev | PASS: полная типизация; 135 shared tests, 106 connection-fabric tests, 1 config-isolation test; 19 Python doc-tool tests. Эти числа отдельно от основного уникального набора. |
| i18n parity / ASCII sort / coverage | PASS во всех 12 каталогах: 5145 базовых английских ключей; в ru/pl сохраняются 6 дополнительных plural forms. Coverage: 5035 literal references / 3642 unique keys. |
| Electron renderer, production Vite build | PASS, 70 s на окончательных исходниках. Предупреждения о крупных chunks, mixed static/dynamic imports и прежних повторных pages/page-info branches остаются. |
| Preload | Оба bundle созданы; bootstrap-preload.cjs и browser-toolbar-preload.cjs отдельно проходят node --check. |
| Main entry point | esbuild bundle + node --check PASS. Есть предупреждения import.meta в CJS. Это сборка/синтаксис, не запуск или упаковка Electron. |
| test:perf-budgets | PASS: 26 тестов и synthetic reports. Harness не измеряет настоящий renderer, GPU, кадры или idle CPU устройства. |
| Документы | 25 открытых опубликованных issues, ацикличные зависимости, 65 исходных экранных групп, 63 QA cases; links/JSON/diff проверены. |
| Визуальный результат / macOS runtime | **BLOCKED / NOT VERIFIED.** Присланный снимок просмотрен только как исходное наблюдение. |

Проверки, входящие в validate:ci, выполнены: validate:dev и три i18n gate. Финальный Electron tsc повторён после последней правки разделителей. Статус GitHub Actions относится к конкретному SHA и проверяется отдельно в PR; локальный PASS не выдаётся за завершившийся удалённый CI.

## Что найдено и исправлено

- Одиночный каталог больше не делит рабочую область с пустым detail; безымянная вкладка и пустая широкая панель Files не занимают постоянную площадь. Сохранённые явные настройки инспектора учитываются.
- Workspace восстанавливает собственные ширины и раскрытия. Старый resize и его timer отменяются до восстановления. В тесном desktop-окне остаётся минимум 320px содержимого; разделители находятся под общим владельцем координат с прокручиваемыми панелями.
- Размеры grid берутся из измеренных tracks, поэтому min-width не вызывает скачка соседней колонки. Направленные команды учитывают неполный ряд; закрытие вкладки возвращает допустимый фокус. Запросы заголовков Knowledge дедуплицируются и ограничиваются.
- Composer раскрывает вторичные элементы; status не перекрывает Stop/model/voice. Follow-up controls не содержат вложенных кнопок. Стрим не сбрасывает чтение старых сообщений и не двигает всю рабочую сетку.
- Запоздалая диктовка не попадает в другую сессию и использует актуальный черновик. Скрытые окна приостанавливают связанные интервалы.
- Notes не принимает устаревшие чтения после переключений A → B → A. Save acknowledgement не очищает более свежий текст; комментарии изолированы по workspace/note. Выделение текста не крадёт фокус, hidden panels закрывают portal sheets.
- Tasks сохраняет раздельные черновики тегов/ссылок/заметок, последовательные изменения и ошибки записи. Meetings сохраняет draft и владельца запроса, завершает failed search и допускает повторный поиск после очистки.
- Settings связывает label/description/error с полями; radio groups, select и switches имеют доступную клавиатурную семантику. Уходящий status становится inert сразу; его timer считает оставшееся видимое время.
- Диагностика поддерживает retry неудачного lazy import и не озвучивает timestamp на каждом обновлении. Предложения используют статус своего workspace и нормализуют повреждённую историю.
- В этой итерации устранены оставшиеся 35 исходных ошибок Electron/type dependencies. После интеграции main исправлены ещё 9 ошибок: сужение типов результатов, ложные queued/verified состояния и потерянные workspace guards. Полномочия и протоколы не расширены.
- Восстановлены 67 отсутствующих ключей × 12 языков; существующие переводы сохранены. Исправлен динамический префикс connections.tabs. Одна устаревшая source-проверка EntityViewTabs заменена актуальным контрактом NotesViewMenu и дополнительной проверкой реального доступа к Map/Canvas.

Первичная база имела 50 TypeScript ошибок и shell suite 403 PASS / 2 FAIL. Предыдущая публикация имела 767 выбранных PASS и 35 оставшихся ошибок типов. Это исторические точки, не текущий результат.

## Воспроизведение

Все команды выполнялись из корня репозитория; Bun 1.3.9, Node 24, Linux. Для выбранных suites используйте команды и точные test_files из [VERIFICATION-RUNS.json](VERIFICATION-RUNS.json). Большой набор postmerge запускался отдельным процессом по списку, без дубликатов:

    python3 - <<'CHECK'
    import json, subprocess
    from pathlib import Path
    report = json.loads(Path('docs/design/golden-gate/VERIFICATION-RUNS.json').read_text())
    suite = next(s for s in report['suites'] if s['id'] == 'postmerge-contracts')
    subprocess.run(['bun', 'test', *suite['test_files']], check=True)
    CHECK

Workspace guards намеренно запускаются в отдельном Bun-процессе, поскольку существующий onboarding suite подменяет тот же config module:

    bun test ./packages/server-core/src/handlers/rpc/__tests__/workspace-guards.isolated.ts

Общие gates:

    bun run validate:dev
    bun run lint:i18n:parity
    bun run lint:i18n:sorted
    bun run lint:i18n:coverage
    bun run test:perf-budgets
    ./node_modules/.bin/tsc --noEmit -p apps/electron/tsconfig.json

Production renderer и preload:

    node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config apps/electron/vite.config.ts
    bun run scripts/electron-build-preload.ts
    node --check apps/electron/dist/bootstrap-preload.cjs
    node --check apps/electron/dist/browser-toolbar-preload.cjs

Проверка main bundle:

    ./node_modules/.bin/esbuild apps/electron/src/main/index.ts --bundle --platform=node --format=cjs --outfile=/tmp/rox-main-check.cjs --external:electron --external:@anthropic-ai/claude-agent-sdk --external:@xenova/transformers --external:onnxruntime-node --external:sharp --alias:node-fetch=./apps/electron/src/main/shims/node-fetch.cjs --alias:abort-controller=./apps/electron/src/main/shims/abort-controller.cjs --alias:bun:sqlite=./apps/electron/src/main/shims/node-sqlite.cjs
    node --check /tmp/rox-main-check.cjs

Путь main bundle приведён в переносимом виде; он не является релизным артефактом. Полная native dependency installation, OAuth defines, секреты и упаковка не входят в успешные gates.

## Открытая приёмка

Cloud Browser явно запретил локальный продуктовый URL и обход ограничения. **Снимков результата изменённого ROX нет.** Пользовательский снимок 2048 × 1329 действительно просмотрен и разобран в [SCREENSHOT-REVIEW.md](SCREENSHOT-REVIEW.md); версия приложения на нём неизвестна. Это baseline, а не подтверждение результата новой ветки. Альтернативный браузер или скрытый обход не применялись.

Не подтверждены: Electron/macOS window lifecycle, настоящие WebContentsView geometry/focus, trackpad/IME/VoiceOver, restart recovery, реальный процессный мониторинг и GPU/frame/idle CPU. Native Browser/SiYuan/Extension доступны только в сфокусированной полностью видимой панели; полноценный compositor одновременно видимых native views не реализован. Подробности: [NATIVE-SURFACES.md](NATIVE-SURFACES.md).

Индивидуальные миграции Chat/Notes/Tasks/Meetings и общих settings существенно расширены; прочие service-specific flows и 8 продуктовых экспериментов не объявлены завершёнными. Остаток подробно описан в [POLISH-REVIEW.md](POLISH-REVIEW.md) и [QA-MATRIX.md](QA-MATRIX.md).

Release gate [GG-025 / #578](https://github.com/rox-one/rox-one/issues/578) и все дочерние задачи остаются открытыми до своих критериев. Успешные unit/SSR/type/build не заменяют визуальную и нативную приёмку.
