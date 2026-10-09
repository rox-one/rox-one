# 00-BRIEF — Developer Space + Playbooks (внутренняя база ТЗ-пака)

Статус: **внутренний рабочий документ**. Источник истины для всех документов пака.
Дата: 2026-10-09. База: `rox-one` @ `0c918497d` (ветка `fix/product-tour-native-green`).
Мандат: пользователь провёл раунд-1 интервью (14 вопросов, рекомендации приняты полностью —
«делай всё как рекомендуешь»). Все решения ниже — **приняты**; альтернативы зафиксированы в `07-DECISIONS.md`.

> Внимание исполнителям: НЕ менять существующие файлы репозитория, НЕ коммитить, НЕ трогать незакоммиченные
> изменения пользователя (M-файлы ветки). Единственная зона записи — каталог этого пака
> `docs/specs/2026-10-09-dev-space-and-playbooks/`.

---

## 1. Продукт (что строим)

Две новые поверхности приложения ROX (Electron + локальный сервер, RU-first):

1. **Developer Space** — «пространство разработчика». Пользователь вставляет ссылку на репозиторий →
   автоматический анализ → единый репо-воркспейс с шестью унифицированными поверхностями-артефактами
   (wiki как DeepWiki, понимание кода, граф кода, схемы, knowledge-graph, C4/OKF-архитектура),
   тремя блоками сгенерированных вопросов (обучение / фичи-имплементация / безопасность+зависимости+производительность),
   визуальными пошаговыми турами по экранам в «демо-режиме» (пульсирующая виньетка, прогресс) и
   свободным чатом под блоками. Гейтинг: онбординг-роль «разработчик» (сеть доступа, дефолты).
2. **ROX Playbooks** — ноутбук-поверхность (референс — SurfSense/NotebookLM): режим **кодбука**
   (ноутбуки-пайплайны по коду) и режим **знаний** (загрузка источников, вопросы по ним, пресет-вопросы,
   подкаст в один клик: мультиагентный сценарий с настраиваемыми ролями, озвучка, плеер, экспорт).

Дополнительно: агенты получают чтение этих поверхностей через session-tools (разные уровни
ответственности: чтение/предложение/применение), обновления репо отслеживаются (freshness/drift).

---

## 2. Принятые решения (D1–D14)

**D1. Онбординг-роль и дефолты.** Добавляем в мастер первого запуска шаг «Кто вы?» (после имени):
разработчик — да/нет + смежные роли (аналитик/дизайнер/продакт/др.). Выбор «разработчик» →
Developer Space **включён по умолчанию**; остальным — **выключен**, но карточка живёт в
Настройки → Разработчикам (пользователь включает сам). «Мягкие сигналы» (вставил ссылку на репо,
подключил git/CLI) используются только как **напоминание** («включить экран разработчика?»),
никогда как молчаливое автовключение. Скип шага безопасен, существующие ветки онбординга
(`git-bash`, `rox-connect`) не ломаются.

**D2. Место Developer Space в навигации.** Новый верхнеуровневый пункт «Разработчикам» (rail/nav destination)
с каталогом репо → репо-пространство. Та же реализация доступна вкладкой/диплинками из Проекта
(одно ядро, две точки входа). Прошлое дизайн-решение «только вкладка внутри Проектов» —
пересмотрено в пользу нового пункта (запрос пользователя).

**D3. Ингест репо.** Клон по ссылке в управляемое пространство проектов (`projects/<slug>`);
приватные репозитории — через существующий GitHub device-login; привязка локальной папки — как
альтернатива. Актуализация: ручная кнопка «проверить свежесть/обновить» (паттерн freshness
code-intelligence) + бейдж «устарело». Авто-watch/pull — не в v1.

**D4. Реестр инструментов: шесть, «одна операция — один инструмент».** Wiki = `langchain-ai/openwiki`;
понимание/обучающие туры = `Egonex-AI/Understand-Anything`; граф кода/символы/вызовы = `codegraph`
(ColbyMcHenry); диаграммы-схемы = `archify` (tt-a1i); knowledge-graph = `graphify` (Graphify-Labs);
C4/OKF-markdown = `Groma.md` (MrLesk). Выпускается **новая ревизия решения** поверх
`CI-DEC-EXTEND-EXISTING-01` с протоколом свежего аудита (причины старых rejection «duplicate/unmaintained»
опровергнуты текущей активностью проектов), правило «без дублей», `alwaysOn=false`, **без демонов**.
Финальный аудит может схлопнуть пересечение groma↔archify по диаграммам (решение зафиксировать в ревизии).

**D5. Генерация.** Основной генератор wiki/понимания — `openwiki` (локальный агентный CLI+MCP,
репо-owned markdown, Mermaid, кросс-ссылки); `deepwiki-open` не берём как обязательный компонент.
Каскад: структурные артефакты (codegraph/groma/graphify/archify) — сразу локально при анализе;
LLM-слой (wiki, «понимание», блоки вопросов) — фоном с прогрессом; UI показывает скелет сразу.

**D6. Эгресс и приватность.** Гранулярное per-repo согласие (аналог гейта PREVIEW/BIND) на:
вызовы настроенных модельных коннектов, сеть для CVE-проверок (OSV) и обновлений инструментов.
Дефолтные исключения `.env*`, `**/*.pem`, `**/*.key`, `**/.codegraph/**` сохраняются; аудит-лог;
локальная модель — рабочая опция. Молчаливого эгресса нет.

**D7. Артефакты.** Источник правды — локальные артефакты в папке проекта (`projects/<slug>/dev-space/...`):
JSON/MD/SVG, версионируемые, с provenance (аналогично снапшотам code-intelligence). Человекочитаемые
страницы публикуются в Notes/Pages (markdown-пайплайн `content:*`, wikilinks, поиск vault-index).
Агенты читают через session-tools (паттерн `knowledge_*`); запись — propose/approve. Обновление —
кнопкой при новом снапшоте + бейдж «устарело»; авто-регенерация не в v1.

**D8. Блоки вопросов.** Предгенерация при анализе: по **10 вопросов на блок** (обучение; фичи/улучшения;
безопасность/зависимости/производительность), пересчёт при новом снапшоте; развёрнутые «ответы» —
по клику (тур или текст); персонализация: онбординг-профиль + репо-контекст + рабочие сигналы
(незакоммиченное, CI), с прозрачной пометкой «почему этот вопрос». В блоке 3 — SBOM (`syft`, optional runner)
+ CVE (OSV) под per-repo согласием.

**D9. Туры.** Расширяем существующий product-tour: **динамические** `TourDefinition`, генерируемые из
артефактов репо (статика каталога остаётся для обучающих туров приложения); новые `TargetId`/`RouteKey`/
`TriggerId`/`CapabilityId` для поверхностей dev space; прогресс «шаг N из M»; персистентность прогонов —
существующая (IndexedDB). Новый движок не строим.

**D10. Демо-режим (визуал туров).** Краевой слой: тёмная радиальная виньетка по периметру окна
(непрозрачность 0.10–0.18) с анимацией «дыхание» 4–6 с; пульс границы целевого блока; существующий
spotlight-механизм сохраняется; прогресс-полоса и «шаг N/M»; кнопки пауза/выход. При
`prefers-reduced-motion` — статичный градиент без пульса.

**D11. Свой вопрос.** Под колонками блоков — стандартный композер ROX (как `ChatPage`: пикер
модели/коннекта, вложения). Запрос уходит в **обычную сессию, привязанную к репо** (видна в списке
сессий, продолжается, инструменты доступны). Ответы могут содержать кнопку «Показать на экранах» →
запуск сгенерированного тура.

**D12. Playbooks: объём и перенос.** v1 = режим **знаний** (источники, пресет-вопросы, подкаст);
затем **кодбук**. Перенос SurfSense — **порт концепций** на наши примитивы (source-index FTS5,
docs block-tree, voice-слой, агентские сессии); Kokoro — опциональный новый TtsEngine за существующей
абстракцией. Вендоринг SurfSense как сайдкар-сервиса и форк кода — не выбираем (второй стек, вес,
неоднозначная лицензия). Имя: «Плейбуки» занимаем как название поверхности; существующий видимый
ярлык SessionWorkbench «playbook holes» переименовываем в «Веера задач» (устранить коллизию).

**D13. Подкаст v1.** Двухголосый диалог (ведущий + эксперт) с редактируемыми шаблонными ролями
(ярлыки/промпты); сценарий — LLM; озвучка — существующие TTS (`edge`, `system`), сегменты → сборка
в один файл (ffmpeg), встроенный плеер + экспорт `mp3`/`srt`. N агентов с произвольными ролями — v1.x
(голоса из фиксированного реестра). Kokoro — опциональный движок (offline), решает вопрос автономности.

**D14. Волны, платформы, процесс.** Волны (одна волна = один PR):
В1 роль+флаги+пространство+клонирование; В2 шесть инструментов/артефакты+рендер-поверхности;
В3 блоки вопросов + туры/демо-режим + свой вопрос; В4 Playbooks-Знания (источники/пресет-вопросы/подкаст);
В5 Кодбук. Native-приёмка macOS+Windows (существующие гейты), webui — вне v1.
Процесс репо: пак в `docs/specs/<date>-<slug>/` (PRD/SPEC/PLAN + acceptance), RX-ids (резерв при старте В1),
i18n 12 локалей (parity/sorted/coverage), зелёные `validate:ci`, `typecheck:all`, ui-lint-ratchet,
`product-tour-native` для затронутых волн.

---

## 3. Карта фактов о текущем коде (grounding)

### 3.1 Онбординг
- Мастер: `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx` — `OnboardingStep = welcome|rox-connect|git-bash|provider-select|local-model|credentials|omp-credential|complete`, `renderStep()`.
- Машина состояний: `apps/electron/src/renderer/hooks/useOnboarding.ts` (`useOnboarding`, `OnboardingEntryPoint`, `finishFirstRun`, `shouldApplyOnboardingLaunchGate`).
- Первый запуск: `WelcomeStep.tsx` (имя) → `onboarding-username.ts` (`nextStepAfterUsername`, `persistOnboardingUsername`) → `finish` (`ensureRoxRuntimeDefault`, `rox-runtime-default.ts`).
- Роли/профессии **нет**; связки «ответ→дефолт фичи» **нет** — всё net-new.
- `EnvironmentPrefs`/`QUESTION_IDS`: `packages/shared/src/environment/types.ts`, `storage.ts`.

### 3.2 Флаги, настройки, навигация
- Флаги: `packages/core/src/platform/workbench/flags.ts` (`WORKBENCH_FLAG`, `WORKBENCH_FEATURE_FLAGS {id,defaultValue,dependencies,rollbackSafe}`), extra screens: `packages/core/src/platform/workbench/extra-screen-flags.ts` (`EXTRA_SCREEN_FLAG`).
- Рендерер-атомы: `apps/electron/src/renderer/atoms/{mode-flags,extra-screens,unified-shell}.ts` (`atomWithStorage`), ключи в `apps/electron/src/renderer/lib/local-storage.ts`.
- Страницы настроек: `apps/electron/src/shared/settings-registry.ts` (`SETTINGS_PAGES`; уточнение: не `packages/shared/src/` — фактический путь проверен), `apps/electron/src/renderer/pages/settings/settings-pages.ts` (`SETTINGS_PAGE_COMPONENTS`), `shared/menu-schema.ts` (`SETTINGS_ITEMS`).
- Примеры тумблеров: `pages/settings/ExtraScreensSettings.tsx`, `WorkbenchChromeSettings.tsx` (`SettingsToggle`).
- Навигация: `apps/electron/src/renderer/components/app-shell/nav-destinations.ts` (`APP_NAV_DESTINATIONS` — 17 записей, «add once»), потребители `AppShell.tsx` (links[]) и `platform/ActivityRail.tsx` (rail groups), рендер — `MainContentPanel.tsx`. `disabledTooltipKey` объявлен, но не используется.

### 3.3 Product-tour (расширяем)
- Каталог: `apps/electron/src/renderer/features/product-tour/` — `contracts/index.ts` (TourId/StepId/TargetId/SignalName/CapabilityId/TriggerId/RouteKey, `TourDefinition`, `TourStep`, `CompletionPolicy`), `catalogue/product-tour-catalogue.ts` (25 туров OBT-01..25, 57 шагов), `catalogue/validate.ts`, `core/index.ts` (чистый переходник), `runtime/ProductTourProvider.tsx` (+`ProductTourHost`, `useProductLearning`), `runtime/routes.ts` (`resolveTourRoute`, `prerequisiteRoute`), `runtime/hooks.tsx` (`useTourTarget(id, options)` → ref-callback; `useTourSignals()`), `runtime/bridge.ts`, `ui/SpotlightOverlay.tsx` (Radix Popover, SVG even-odd маска @0.4), `ui/TourPopover.tsx`, `ui/target-registry.ts` (ready|blocked: target-missing/occluded/ambiguous), `ui/geometry.ts`, `persistence/database.ts` (IndexedDB `rox-product-tour`).
- Флаг включения: `storage.KEYS.featureProductTourV1` (ProductTourProvider:85). Счётчика «шаг N/M» в прогоне нет. Список туров — `pages/settings/LearningSettingsPage.tsx`.
- Выход в UI: новые `TourDefinition` должны попадать в динамический источник каталога; цели регистрируются `useTourTarget`; сигналы «verified» не могут приходить из `ui-observation` (гвард в core).

### 3.4 Чат (для «своего вопроса»)
- `apps/electron/src/renderer/pages/ChatPage.tsx` → `components/app-shell/ChatDisplay.tsx` (транскрипт+композер), композер: `components/app-shell/input/{ChatInputZone,InputContainer,FreeFormInput,CompactModelSelector}.tsx`.
- Модель-пикер: `hooks/useSessionModelCatalog.ts` → `window.electronAPI.getSessionModelCatalog(sessionId)`; коннекты: `packages/shared/src/config/llm-connections.ts`; `AppShellContext` содержит `llmConnections`, `sessionModelCatalog`, `workspaceDefaultLlmConnection`.

### 3.5 Code Intelligence (переиспользуем и расширяем)
- Контракты: `packages/shared/src/code-intelligence/types.ts` (`CodeIntelAdapter`, `CodeGraph`, `CodeSymbol`, `CodeEdge ('contains'|'imports')`, `CodeCitation`, `REJECTED_CODE_INTEL_TOOLS` = CodeWiki/DeepWiki/Graphify/Archify, `SELECTED_CODE_INTEL`), `provider.ts` (`CI-DEC-EXTEND-EXISTING-01`, `CodeIntelligenceProviderRegistry`, `sourceRevision`+`artifactDigest` для не-базовых провайдеров), `refs.ts` (RepositoryBinding/Snapshot/FileSpan/`rox-code:v1:` refs, freshness), `sbom.ts` (`runSyftSbom`, optional runner, никогда не устанавливает), `explainer.ts` (`materializeArchitectureNote`, provenance-гварды), `local-adapter.ts`.
- Сервер: `packages/server-core/src/handlers/rpc/code-intelligence.ts` (PREVIEW/BIND/CAPTURE/LIST/READ_SPAN/FRESHNESS/CANCEL; `dataEgress:'deny'`; storage `projects/<slug>/code-intelligence/<bindingId>/<policyFingerprint>/snapshot_*.json`).
- UI сегодня: `apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx` внутри `pages/ProjectRoadmapPage.tsx`.

### 3.6 Источники/знания/документы (для Playbooks и публикации артефактов)
- Индексация источников: `packages/server-core/src/sources/source-index.ts` (SQLite FTS5 `.craft/source-index.sqlite`, `retrieveSourcesForPrompt`, лимиты: 512KB/файл, 32MB, 2000 файлов; bun:sqlite с LIKE-fallback), фасад `source-index-facade.ts`, watch `source-index-watch.ts`; RPC `sources:REINDEX|SEARCH|STATUS`, UI `SourcesListPanel.tsx`.
- Vault-индекс Notes: `packages/server-core/src/knowledge/vault-index.ts` (documents/wikilinks/backlinks/tasks/entities), `knowledge:search`, провайдер `NativeNotesKnowledgeProvider` ('local-markdown', read-only), SiYuan-поверхность **жёстко выключена** (`KnowledgeSurfacePage.tsx`: `knowledgeEnabled=false`).
- Документы: `content:*` RPC (`resolve/describe/adoptDescriptor/commitMarkdown/getCommitReceipt/getBlockTree/...`), commit-store `server-core/src/docs/markdown-commit.ts` (durable receipts, HASH_CONFLICT/DOCUMENT_BUSY), block-tree проекции `packages/core/src/docs/*`.
- Файлы: `handlers/rpc/files.ts` (20MB MAX_FILE_SIZE; READ_USER_ATTACHMENT 50MB; STORE_ATTACHMENT: Office→MD через markitdown-js), `transfer.ts` (chunked), session-attachments схема.
- Агентские инструменты чтения: `packages/session-tools-core/src/handlers/{knowledge-read,knowledge-search,knowledge-propose,knowledge-backlinks}.ts`.

### 3.7 Голос (для подкаста)
- `packages/shared/src/voice/{types,capabilities,contracts}.ts`: `TtsEngine='system'|'edge'`; ASR `local-whisper|cloud-rox` (Deepgram Nova-3, диаризация).
- TTS: `server-core/src/handlers/rpc/system-tts.ts` (macOS `say`), `shared/src/voice/adapters/edge-tts.ts` (edge-tts CLI pinned 7.2.8; голоса `ru-RU-SvetlanaNeural`/`en-US-AriaNeural`; base64 mp3 ≤16MB; evidence `not-sent|possible|sent`).
- Джобы: `shared/src/voice/job-machine.ts`, `host.ts`; пуш `voice:JOB`/`voice:OVERLAY` с монотонным seq; плеер `renderer/lib/message-tts.ts` (+ 'Слушать' в ChatDisplay).
- Мультиспикерного аудио/миксдауна **нет** — net-new (сегменты→ffmpeg→файл).

### 3.8 Процессы/спавн (для джобов анализа)
- `shell:exec`: `apps/electron/src/main/handlers/system.ts:314` (`/bin/zsh -lc`, **timeout 20 s**, 1 MiB) — для длинных пайплайнов НЕ подходит.
- Паттерны: extension host (`main/extension-host/*`, utilityProcess.fork, capability-broker), privileged broker (`server-core/src/services/privileged-execution-broker.ts`, approvals+audit jsonl), toolchain manager (`handlers/rpc/toolchain.ts`), agent SDK subprocess (`shared/src/agent/*`), cloud-runner local (`packages/cloud-runner/src/local-provider.ts`), automations (`packages/server-core/src/handlers/rpc/automations.ts`), workflows-движок (`packages/server-core/src/workflows/*`; RPC-каналов `workflows:*` нет), tasks Conductor (`packages/core`).
- GitHub: device login `workgraph:startGithubDeviceLogin|pollGithubDeviceLogin|cancelGithubDeviceLogin` (`server-core/src/workgraph/github-oauth-import.ts`), токены в credential store, рендеру не отдаются; **clone API нет**.

### 3.9 i18n и дизайн
- 12 локалей: `ar de en es fr hu ja ko pl ru zh-Hans zh-Hant`; RU — дефолт; ключи ASCII-sorted; `lint:i18n:parity|sorted|coverage`; файлы `packages/shared/src/i18n/locales/*.json`.
- DESIGN.md: RU-first, графит+один акцент, 4/8px сетка, радиусы 6–8/10–12, motion 160–220 ms ease-out; токены `packages/ui/src/styles/tokens/*` (motion: 0/120/180/240ms), z: popover/100, scrim/200, modal/210, fullscreen/350; reduced-motion гасит токены и `motion-reduce:*`.

### 3.10 Гейты и процесс репо
- Гейты PR: `validate:ci` (= `validate:dev` + i18n parity/sorted/coverage), `typecheck:all`, ui-lint-ratchet, `product-tour-native.yml` (macos-15/windows-2025) при изменениях renderer/**, unified-gates (Postgres), `rx:validate`.
- Документы: `docs/specs/<date-slug>/` паки, `docs/plans/`, «одна волна = один PR», RX id реестр `registry/rx-registry.yaml` + `registry/RX-LEGEND.md`, acceptance-образец `docs/product-tour/{PRD,SPEC,acceptance-cases.json}`.

---

## 4. Внешние инструменты (веб-аудит 2026-10-09) и пины дизайн-корпуса

| Роль | Инструмент | Лицензия/стек | Заметки |
|---|---|---|---|
| Wiki | `langchain-ai/openwiki` (запинован в корпусе: v0.6.1, MIT, `fab24e77…`; Node≥22.22) | TS, npm `openwiki`, MCP (tools `openwiki_search/read/list_workspaces/list_wikis` + generation flow), выход: связанный markdown + Mermaid + визуализатор | локальный агентный; репо-owned |
| Wiki (альтернатива) | `AsyncFuncAI/deepwiki-open` | MIT, FastAPI+Next, self-host web | НЕ обязателен (D5); отдельный веб-стек |
| Понимание | `Egonex-AI/Understand-Anything` (skill уже вендорен: `apps/electron/resources/skills/understand-anything/**`, @1d7418b8, MIT) | TS, multi-agent, `.ua/knowledge-graph.json`, dashboard, туры | источник «обучающих» материалов |
| Граф кода | `ColbyMcHenry/codegraph` | MIT; Rust+TS CLI; SQLite `.codegraph/codegraph.db` (FTS5); `codegraph serve --mcp` | уже есть MCP-каталог `codegraph` (= CodeGraphContext uvx 0.6.13) — финальный аудит выберет канонического (TODO(open) O1) |
| Схемы | `tt-a1i/archify` | MIT; JS; agent-skill; typed JSON IR → HTML/SVG; PNG export | |
| Knowledge-graph | `Graphify-Labs/graphify` | Apache-2.0; Python tree-sitter; `/graphify`; выход `graphify-out/{graph.html,GRAPH_REPORT.md,graph.json}`; EXTRACTED/INFERRED | в репо есть vendored `gstack graphify-adapter` |
| C4/OKF | `MrLesk/Groma.md` (запинован: v0.6.0, MIT, `46b1572d…`) | TS, npm `groma.md`; выход `groma/` markdown OKF 0.2 (C4) + static export | генерация локальная, без AI |
| Референс wiki | Devin DeepWiki | — | эталон UX: авто-вики с диаграммами и кросс-ссылками |
| Ноутбуки/подкаст | `MODSetter/SurfSense` | README: Apache-2.0 (GitHub API: «Other» — юр-риск); Electron+FastAPI; SQLite FTS5+sqlite-vec; подкаст 2 голоса, offline Kokoro-82M | только как референс/идеи (D12) |
| TTS offline | Kokoro-82M (audio.cpp) | — | опциональный третий TtsEngine |

Конфликт для пересмотра: `apps/electron/resources/skills/...`/`capabilities/packs.ts` объявляет
codewiki/deepwiki/graphify/archify/understand-anything/codegraph как «available» с placeholder
репозиториями (`sourceRepo: example/*`) — гэп `CI-G-08 CURRENT_SOURCE_CONFLICT` из корпуса;
ревизия D4 обязана это согласовать (TODO(open) O7).

Дизайн-корпус (референс экранов): `docs/lark-suite-reference/13-code-intelligence.md` (пины, MCP-контракты,
решения), `14-code-intelligence-ui.md` (**RC-01..RC-12**: Repository connection, Overview, Wiki reader,
Wiki generation plan, Wiki review/diff, Diagram, Code search, Grounded answer, Source viewer,
Groma architecture (C4), Drift/change review, Runs and recovery), `11-decisions-open-questions.md`;
машинные каталоги `plans/lark-suite-reference/code-intelligence.json`. Предлагаемые ROX-агентские
инструменты в корпусе: `repo_status, code_search, code_read, architecture_read, repo_wiki_search,
repo_wiki_read, intelligence_plan, intelligence_run, artifact_propose, artifact_apply`.

---

## 5. Риски и гэпы (учесть в SPEC)

1. `shell:exec` 20 s — длинные пайплайны требуют job-механизма (agent SDK spawn / automations / cloud-runner local): выбрать и специфицировать.
2. `source-index` требует bun:sqlite; под чистым Electron/Node есть ts-fallback — учесть в retrieval для Playbooks.
3. Нет clone-API — новый RPC-контур ингеста; GitHub-токен не выходит в рендер.
4. Нет мультиспикерного аудио/миксдауна — новый пайплайн подкаста (ffmpeg внешним вызовом через существующие spawn-паттерны).
5. Лицензия SurfSense неоднозначна — не вендорить код без юр-проверки (уже решено D12).
6. Коллизия имени «Плейбуки» — переименование старого ярлыка (D12).
7. SiYuan-поверхность выключена — Playbooks не строить на ней.
8. i18n: любые новые строки — во все 12 локалей + гейты.
9. Native-приёмка только macOS/Windows (Linux = NOT_RUN) — так и планировать.
10. UX-требование «всё предрендерить» против стоимости LLM — каскад D5/D8 с прогрессом.

---

## 6. Открытые вопросы (единый список TODO(open))

- O1: канонический codegraph-провайдер (ColbyMcHenry/codegraph vs CodeGraphContext) — решить аудитом ревизии D4.
- O2: схлопывать ли groma/archify (пересечение диаграмм) — по результатам ревизии.
- O3: точный выбор job-движка для пайплайнов (agent-spawn vs automations vs cloud-runner) — за SPEC-foundations, с критериями.
- O4: где хранить клоны (в `projects/<slug>` vs отдельный `repos/`) — рекомендация SPEC: `projects/<slug>` как репо-проект.
- O5: Kokoro — включать ли в v1 или v1.x (решить по объёму работ В4).
- O6: формат `srt` — обязателен ли в v1 (по умолчанию да, простое генерирование из сегментов).
- O7: финальные пины/лицензии всех шести инструментов на момент старта В2 (зафиксировать в ревизии).
- O8: политика пересчёта блоков при «грязном» рабочем дереве (dirty snapshot) — по умолчанию: пересчёт по явной команде.

---

## 7. Карта файлов пака (не дублировать содержание между файлами)

| Файл | Автор | Содержание |
|---|---|---|
| `README.md` | writer-7 | индекс пака, как читать, статус, глоссарий, связи документов |
| `01-PRD.md` | writer-1 | цели/нецели, персоны, входные точки, сценарии, FR-xx (проверяемые), состояния, метрики |
| `02-SPEC-foundations.md` | writer-2 | платформа: гейтинг роли, IA, ингест, джобы, артефакты/хранение, эгресс, агентский доступ, флаги/настройки, i18n, безопасность |
| `03-SPEC-features.md` | writer-3 | инструменты-адаптеры (6), блоки вопросов, туры+демо-режим, свой вопрос, Playbooks (знания/код), подкаст, голос |
| `04-UI-SPEC.md` | writer-4 | экраны (адаптация RC-01..12 + новые), компоновка, состояния, токены/моушн/a11y, reduced-motion |
| `05-PLAN.md` | writer-5 | волны В1–В5: файлы, флаги, DoD, гейты, ownership, RX-план, риски |
| `06-acceptance-cases.json` | writer-6 | машиночитаемые кейсы (валидный JSON), покрытие всех областей |
| `07-DECISIONS.md` | writer-7 | журнал решений D1–D14 + производные (альтернативы, обоснования, статус «принято») |

Общие требования к документам: русский язык; каждое утверждение о существующем коде подкреплено точным
путём из этого брифа; новые сущности помечаются «новое»/«расширение»; неизвестное — `TODO(open)` (O1–O8);
никаких выдуманных путей/флагов/каналов; стиль — спека для инженера, без воды.