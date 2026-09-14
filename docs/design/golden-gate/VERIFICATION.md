# Golden Gate: фактическая проверка

Дата: 2026-09-14. Начальная база аудита: `22c8b89858f8c41d3f687f13d49a31b55045c146`.
Код интегрирован и проверен после rebase на `828a8aebb34780c03088bea0cd896a00fdf88b7c` из `main`.
Последующие изменения перед публикацией относятся только к этому отчёту, индексу документов и метаданным issues.

## Результат

**767 тестов прошли, 0 упали в пяти выбранных наборах / 133 файлах.** Это покрытие изменённых контрактов и связанных регрессий, а не утверждение о запуске всех тестов монорепозитория.

| Набор | PASS / FAIL | Файлы |
|---|---:|---:|
| Оболочка, навигация, состояние панелей | 437 / 0 | 86 |
| Геометрия, предложения, native ownership, диагностика | 56 / 0 | 9 |
| Общие экранные компоненты, настройки, темы, Markdown | 116 / 0 | 22 |
| Tasks/Meetings selection и существующие meeting handlers | 45 / 0 | 11 |
| Локализация | 113 / 0 | 5 |

| Дополнительная проверка | Результат |
|---|---|
| Electron renderer, production Vite build | PASS, 69 s. Остались прежние предупреждения о крупных chunks и дублированных `pages/page-info` branches в route parser. |
| Preload: оба entry points и `node --check` | PASS. |
| Main entry point: esbuild bundle + `node --check` | PASS. Это проверка сборки/синтаксиса, не запуск Electron и не проверка упаковки. |
| Shared UI TypeScript | PASS. |
| Electron TypeScript | FAIL: 35 диагностик; все присутствуют в начальной базе. Новых диагностик нет после сравнения path + message без line/column. |
| Locale parity | PASS: 12 каталогов, по 5044 ключа; команда выводит 11 переводов относительно en. |
| ASCII-сортировка locale keys | PASS. |
| Структура документации | 25 опубликованных issues; ацикличные зависимости; все 22 settings в inventory; 65 screen groups; 45 QA cases. |
| Product visual / macOS runtime / GPU performance | **BLOCKED / NOT VERIFIED.** |

Начальная база имела 50 TypeScript диагностик и 403 PASS / 2 FAIL в shell suite. В этой ветке исправлены 15 TypeScript диагностик в навигации и Tasks/Meetings. Две исходные проверки presentation теперь проходят: из sidebar profile убран уровень (он остаётся на странице аккаунта), из Accounts удалён избыточный вводный текст. Тестовые ожидания не ослаблялись ради этих двух результатов.

## Что проверялось

- Геометрия 0/1/2/4/5/6/7 панелей, режимы auto/columns/grid-2/grid-3/focus, reset, отдельное хранение геометрии, resize preview/commit/cancel, сохранение route identity.
- Compact service/panel menu и доступ ко всем destinations; roving tab fallback при активном browser; отсутствие пустого navigator для dedicated services.
- Native hidden/inert/clipping, scroll invalidation, максимум один geometry pass за кадр, stale callback cancellation, owner-only cleanup. Serial queue проверена через deferred promises: A → B → release заканчивается null; failure позволяет retry при следующем invalidation.
- Диагностика: construction без polling, serial requests, visibility/close abort, поздние ответы, bounded commands/logs, sender/main-frame authorization, исключение URL credentials из копируемого снимка.
- Успешное завершение, interrupt/error gating, приоритет ошибок, дедупликация 100 routine events, idle/cooldown/dismiss, подготовка draft без автоматической отправки.
- Tasks/Meetings: controlled selection из route, direct/back/forward состояния, missing ID без случайного выбора соседа; existing getMeeting для записи за пределами первого каталога.
- Согласованные темы и font roles, общие controls, Markdown links/citations, settings/collection/dialog contracts и 12 локалей.

Часть существующих suites проверяет source wiring; чистые модели и SSR проверки не заменяют взаимодействие с настоящим окном приложения.

## Команды

Все команды выполнялись из корня репозитория. `bun` — 1.3.9; Node — 24. В среде использовался абсолютный путь к Bun; здесь приведён переносимый эквивалент.

### shell

```sh
bun test apps/electron/src/renderer/components/app-shell/__tests__ apps/electron/src/renderer/platform/__tests__ apps/electron/src/renderer/atoms/__tests__
```

### features

```sh
bun test apps/electron/src/renderer/lib/__tests__/panel-workspace-layout.test.ts apps/electron/src/renderer/lib/__tests__/contextual-suggestions.test.ts apps/electron/src/renderer/lib/__tests__/native-surface-dom.test.ts apps/electron/src/renderer/lib/__tests__/native-surface-owners.test.ts apps/electron/src/renderer/lib/__tests__/native-surface-visibility.test.ts apps/electron/src/main/device-diagnostics-collector.test.ts apps/electron/src/main/device-diagnostics-ipc.test.ts apps/electron/src/renderer/components/app-shell/diagnostics
```

### screens

```sh
bun test apps/electron/src/renderer/components/settings/__tests__ apps/electron/src/renderer/components/app-shell/collection/__tests__ apps/electron/src/renderer/pages/settings/__tests__/settings-chrome-p35.test.ts packages/ui/src/components/ui/__tests__/styled-dropdown.test.ts packages/ui/src/styles/__tests__ packages/shared/src/config/theme-vibrancy.test.ts packages/ui/src/components/markdown/__tests__/sourced-statement.test.tsx packages/ui/src/components/markdown/__tests__/markdown-link-routing.test.ts
```

### catalog

```sh
bun test apps/electron/src/renderer/pages/__tests__/catalog-detail-routes.test.tsx apps/electron/src/renderer/pages/meetings/__tests__
```

### i18n

```sh
bun test packages/shared/src/i18n
```

### parity

```sh
bun run scripts/check-i18n-parity.ts
```

### sort

```sh
bun run scripts/sort-locales.ts --check
```

### typecheck-electron

```sh
./node_modules/.bin/tsc --noEmit -p apps/electron/tsconfig.json
```

### typecheck-ui

```sh
./node_modules/.bin/tsc --noEmit -p packages/ui/tsconfig.json
```

### renderer

```sh
node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config apps/electron/vite.config.ts
```

### preload

```sh
bun run scripts/electron-build-preload.ts
```

### Main bundle

```sh
./node_modules/.bin/esbuild apps/electron/src/main/index.ts --bundle --platform=node --format=cjs --outfile=/tmp/rox-main-check.cjs --external:electron --external:@anthropic-ai/claude-agent-sdk --external:@xenova/transformers --external:onnxruntime-node --external:sharp --alias:node-fetch=./apps/electron/src/main/shims/node-fetch.cjs --alias:abort-controller=./apps/electron/src/main/shims/abort-controller.cjs --alias:bun:sqlite=./apps/electron/src/main/shims/node-sqlite.cjs
node --check /tmp/rox-main-check.cjs
```

Путь временного bundle заменён на переносимый `/tmp`; он не является релизным артефактом. OAuth defines, загрузка секретов и публикация пакета для этой проверки не выполнялись.

## Незавершённая приёмка

Доступный Cloud Browser явно запретил локальный продуктовый URL и обход этого ограничения. Поэтому **нет фактически просмотренных снимков изменённого ROX**. Снимок внешнего 21st.dev — только референс, не доказательство качества приложения. Альтернативный браузер или скрытый обход политики не применялся.

Electron/macOS запуск, WebContentsView geometry на реальном окне, trackpad/IME/VoiceOver, restart recovery и GPU/frame/idle CPU измерения не подтверждены. Linux runtime не заменяет macOS: системные child-process ограничения этой среды не позволили подтвердить production process-table sampling. Native dependency installation и упаковка полного приложения также не являются успешным gate этой поставки.

Встроенные native Browser/SiYuan/Extension поверхности пока показываются только в **сфокусированной, полностью видимой** панели. Частично обрезанная поверхность сохраняет instance и показывает действие «Показать панель»; полноценный native compositor для нескольких одновременно видимых WebContentsViews не реализован. Подробности: [NATIVE-SURFACES.md](NATIVE-SURFACES.md).

Индивидуальные экранные миграции/визуальные эксперименты из GG-008…024 остаются в backlog даже при наследовании общих компонентов. 8 экспериментов имеют гипотезы и критерии в [PRD.md](PRD.md), но не объявлены подтверждёнными продуктовыми результатами.

Release gate: [GG-025 / #578](https://github.com/rox-one/rox-one/issues/578). Все задачи остаются открытыми до своих критериев приёмки. Полные маршруты/сценарии и требования к разрешённому стенду: [QA-MATRIX.md](QA-MATRIX.md).

