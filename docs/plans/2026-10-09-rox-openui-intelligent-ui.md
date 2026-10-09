---
title: OpenUI: интерактивные ответы агента в чате ROX
status: in-progress
branch: feat/intelligent-ui-20261009
date: 2026-10-09
---

# Умные ответы (OpenUI / Intelligent UI) в ROX

## Цель

Ответы ассистента в чате ROX могут содержать интерактивный блок (график, таблица, форма, карточки), как в ChatGPT Intelligent UI. Реализация — открытая: [thesysdev/open-intelligent-ui](https://github.com/thesysdev/open-intelligent-ui) поверх OpenUI (`@openuidev/*`), без облачного Gateway: модель генерирует OpenUI Lang, клиент рендерит его локально.

## Контракт (заморожен)

1. Ответ содержит не более одного блока ` ```openui ` с программой на OpenUI Lang — это правило уровня промпта; рендерер допускает несколько фенсов (каждый рендерится независимо, со своим `blockId`). Проза вокруг блока самодостаточна в любом Markdown-клиенте.
2. Рендер: `Renderer` из `@openuidev/react-lang` с библиотекой `openuiChatLibrary` (`@openuidev/react-ui/genui-lib`), тема — ROX через `ThemeProvider` + `createTheme` из токенов ROX; стили — `@openuidev/react-ui/styles/index.css` внутри ленивого чанка.
3. Ошибка разбора или рендера после завершения стрима: предупреждение + откат к обычному `CodeBlock` (как у mermaid/datatable). Во время стрима ошибки не показываются, частичная программа дорисовывается по мере поступления.
4. Действия: `continue_conversation` (`@ToAssistant`) отправляет следующее пользовательское сообщение через новый колбэк `onSendPrompt` (текст = `humanFriendlyMessage` + JSON `formState`, если есть); `open_url` уходит в существующий `onUrlClick`. Формы во время стрима заблокированы (`isStreaming`).
5. Новые строки UI — 3 ключа i18n во всех 12 локалях: `openui.label`, `openui.loading`, `openui.renderError`.
6. Агент узнаёт о возможности из OMP-контекста (`OMP_ROX_CONTEXT_PROMPT`) и справочника `~/.craft-agent/docs/openui.md` (`DOC_REFS.openui`; источник — `apps/electron/resources/docs/openui.md`, генерируется из библиотеки скриптом).
7. Только клиентский рендер: без OpenUI Gateway, без runtime-сети из пакета (tel-метрия lang-core отключена: postinstall заблокирован bun, в генераторе `OPENUI_TELEMETRY_DISABLED=1`).
8. Тяжёлый чанк (`@openuidev/*` + recharts) загружается лениво при первом блоке — как mermaid в PERF-04.

## Зависимости (уже поставлены в root `package.json`)

`@openuidev/react-ui@0.16.3`, `@openuidev/react-lang@0.3.0`, `@openuidev/react-headless@0.16.3` (peer-диапазон требует `<0.17`), `zustand@^4.5.5`. React 18.3.1 и zod 4 попадают в peer-диапазоны; `zod` импортируется как `zod/v4`.

## Волны

| Волна | Область | Файлы |
| --- | --- | --- |
| W1 | Ядро рендера | `packages/ui/src/components/markdown/{MarkdownOpenUIBlock.tsx,openui-theme.ts,lazy-blocks.tsx,Markdown.tsx,linkify.ts}`, экспорт `@rox/ui`, peer-запись, тесты |
| W2 | Проводка в чат | `packages/ui/src/components/chat/TurnCard.tsx`, `apps/electron/.../app-shell/ChatDisplay.tsx`, `.../components/markdown/StreamingMarkdown.tsx`, playground-story, браузерный тест на Chromium |
| W3 | Сторона агента | `packages/shared/src/agent/omp-agent.ts`, `prompts/system.ts`, `docs/index.ts`, `apps/electron/resources/docs/openui.md`, `scripts/openui/`, README |
| W4 | i18n | `packages/shared/src/i18n/locales/*.json` (12) |

## Проверка

- `bun run typecheck:all`; целевые `bun test` по `packages/ui` (markdown), `packages/shared` (agent/i18n), `scripts/openui`.
- `bun run lint:i18n:parity && lint:i18n:sorted && lint:i18n:coverage`.
- Chromium-смоук: фенс → реальный рендер (график, таблица, форма), стриминг, ошибка → fallback, клик по кнопке → `onSendPrompt`, повторный маунт с тем же `blockId` → состояние формы сохранено.
- `bun run electron:build:renderer`: чанк `@openuidev` ленивый, стартовый бандл не вырос (цель ~2.5 МБ из `vite.config.ts`).
- Adversarial-ревью: CSP, оффлайн, инъекции в Lang, отсутствие сетевых запросов.

## Риски

- `react-ui@0.16.3` под React 18.3.1 заявлен peer-диапазоном; подтверждаем смоуком. Откат: `react-ui@0.17.0` + `react-headless@0.17.x` (тоже `^18.3.1`).
- Размер ленивого чанка ~2 МБ — приемлемо; гейт `cached_session_switch` (p95 120 мс) не затрагивается.
- `linkify.findCodeRanges` переписывает URL/пути внутри незакрытого фенса → правим: незакрытый фенс тянется до EOF.
- `TurnCard.shouldShowContent` требует ≥15 слов для текста с ` ``` ` — блок может появиться с задержкой до ~2.5 с; наблюдаем в смоуке, гейт не меняем.
- `Query()/Mutation()` в Lang не поддерживаются (нет `toolProvider`) — запрещены промптом-справочником.

## Источники

- Твит: `github.com/thesysdev/open-intelligent-ui` (демо, `AgentInterface` + travel-компоненты), `openui.com` docs.
- Решения RFC: `Renderer` props (`response`, `library`, `isStreaming`, `onAction`, `onStateUpdate`, `initialState`, `onParseResult`, `onError`), `ActionEvent.type = continue_conversation`.

## Результаты (закрыто 2026-10-09)

### Что реализовано

| Слой | Файлы |
| --- | --- |
| Рендер | `packages/ui/src/components/markdown/{MarkdownOpenUIBlock.tsx,openui-theme.ts,openui-program-guard.ts,lazy-blocks.tsx,Markdown.tsx,linkify.ts,MarkdownDocBlock.tsx,index.ts}` |
| Чат | `packages/ui/src/components/chat/TurnCard.tsx`, оверлеи (`DocumentFormattedMarkdownOverlay`, `AnnotatableMarkdownDocument`, `ActivityCardsOverlay`), `apps/electron/.../ChatDisplay.tsx`, `.../StreamingMarkdown.tsx` |
| Агент | `packages/shared/src/agent/omp-agent.ts`, `prompts/system.ts`, `docs/index.ts`, `apps/electron/resources/docs/openui.md` (генерируется), `scripts/openui/generate-doc.ts` |
| Приватность | `apps/electron/src/main/renderer-session-policy.ts` — блок favicon-запросов к Google на сессии рендерера |
| i18n | `openui.label`, `openui.loading`, `openui.renderError` × 12 локалей |
| Тесты | `packages/ui/.../__tests__/{markdown-openui-block,openui-program-guard,linkify-unterminated-fence}`, браузерный фикстур-тест `apps/electron/.../openui-block/`, `scripts/openui/__tests__/generate-doc`, `apps/electron/src/main/__tests__/renderer-session-policy` |

Пользовательские сообщения также рендерят фенсы ` ```openui ` (preview-блоки включены и там, как у mermaid/datatable).

### Итерации ревью

1. Корректность: коллизия `blockId` между сообщениями (введён `blockScope`), запись состояния во время стрима, залипание пустого блока, отсутствие notice у error boundary, `isStreaming` для плана, проброс `isStreaming/onSendPrompt/blockScope` в оверлеи, подавление вложенного `openui` в `markdown-preview`.
2. Безопасность: DoS — экспоненциальный инлайнинг ссылок в парсере вендора (517 Б → минуты); закрыт статическим бюджетом (`maxNodes 10 000`, `maxStatements 400`) со сканером, повторяющим разбор вендора (скобки, строки, тернарники, комментарии). Adversarial-проверка нашла обход через многострочные выражения — закрыт и подтверждён независимой пробой.
3. Приватность: утечка hostname цитируемых источников в Google favicons — запрос отменяется на уровне сессии; компонент деградирует до глобуса.
4. Безопасность-2 (адверсарная перепроверка независимым агентом, два круга). Найдено: обратные цепочки ссылок обходили forward-оценку (`s1 = Card([s2, s2])` … `s100 = TextContent("x")`, 2.3 КБ → разворачивание 2^k, рендер убит по таймауту >10 с; k=22 → 4.2 млн узлов); сам сканер был квадратичен на пробежных прогонах (200 КБ пробелов → ~40 с); множитель `@Each` (шаблон × элементы массива) не учитывался (оценка 7.8 k → 1.4 млн узлов в дереве). Закрыто: оценка — сатурационный fixed point (last-wins, неразрешимый цикл → отказ), скан однопроходный, `@Each` считается по разрешимой длине массива (литерал, цепочка ссылок, `@Filter`/`@Sort` по операнду), неразрешимый массив — ограниченный множитель 64, а билтин над неразрешимым операндом сатурируется. Свидетели k=20/22/100 и each-max теперь отвергаются, 200 КБ пробелов — p50 5 мс; все 5 примеров справочника и 4 фикстуры приложения остаются разрешены (запас ≥7598 узлов). Также при закрытии бюджета поправлен контракт стрима: завершённый фенс посреди незавершённого хода больше не активирует формы (см. проверки).

### Проверки (все зелёные на этой ревизии)

- `bun run typecheck:all` — все пакеты и `apps/electron`.
- `bun test packages/ui/src/components/markdown` — 271/0 (25 файлов).
- Браузерный смоук на реальном Chromium — 11/11: фенс → таблица/recharts/кнопка, клик → `onSendPrompt`, отправка формы с плоской JSON-картой, стриминг и разблокировка после завершения, завершённый фенс посреди стрима остаётся заблокированным до конца хода (red→green регресс), notice+fallback для невалидной/пустой/сверхбюджетной программы, изоляция состояния по `blockScope`, сохранение значения после remount.
- `bun test scripts/openui packages/shared/src/agent/__tests__/omp-session-flow.test.ts` — 20/0.
- `bun lint:i18n:parity|sorted|coverage` — OK.
- `bun run electron:build:renderer` — OK. Чанк `MarkdownOpenUIBlock-*.js` (2.36 МБ) отдельный, не входит в modulepreload `index.html`; код OpenUI отсутствует в стартовых чанках.
- Визуально (Chromium, оба режима, скриншоты в `~/Pictures/Shots/Agents/rox-openui-block/`): таблица 3 строки, график 802×326 (3 столбца, подписи категорий), кнопка; текст карточки `oklch(0.225…)` в светлой теме и `oklch(0.92…)` в тёмной; переполнения нет, ошибок страницы нет.

### Ограничения

- Интерактивное состояние форм живёт в памяти процесса (ключ `blockScope|blockId`, LRU 32) и не персистится между перезапусками.
- `Query()/Mutation()` запрещены промптом: рендер без `toolProvider`.
- Бюджет программы — защитный порог, а не языковое ограничение; при необходимости он меняется в `OPENUI_PROGRAM_BUDGET`.