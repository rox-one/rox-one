# 05-PLAN — волны реализации Developer Space + Playbooks

Статус: план (writer-5). Источник истины — `00-BRIEF.md` (решения D1–D14, карта фактов §3, риски §5,
открытые вопросы O1–O8). Формат волн зафиксирован D14: **одна волна = один PR**, волны сливаются
строго по порядку В1→В2→В3→В4→В5.

Ссылки на приёмочные кейсы — по областям из `06-acceptance-cases.json`
(канонические префиксы: `ONB`, `DEV`, `ING`, `PIPE`, `ART`, `QST`, `TOUR`, `CHAT`, `PLB`, `POD`,
`CBK`, `SEC`, `I18N`, `A11Y`). Точный id кейса ищется по префиксу области.

Обозначения: **новое** — сущности, которых нет в репозитории; **расширение** — изменение
существующего файла; пути существующих файлов — из брифа §3 (проверены), пути новых файлов —
кандидаты (могут уточниться при реализации).

---

## 1. Общие правила для всех волн

### 1.1 Гейты (обязательны в каждом PR волны)

| Гейт | Команда/источник | Обязателен |
|---|---|---|
| validate:ci | `bun run validate:ci` (= `validate:dev` + i18n parity/sorted/coverage, `package.json`) | всегда |
| typecheck:all | `bun run typecheck:all` (`package.json`) | всегда |
| ui-lint-ratchet | `bun run lint:ui-tokens` (`scripts/lint-baseline.ts --check`) | волны с изменениями renderer/**, ui | 
| product-tour-native | `bun run test:product-tour:native` + workflow `product-tour-native.yml` (macos-15 / windows-2025) | renderer-волны (В1, В2, В3) |
| rx:validate | `bun run rx:validate` | всегда |
| i18n | `bun run lint:i18n:parity && bun run lint:i18n:sorted && bun run lint:i18n:coverage` | всегда (любые новые строки) |
| unified-gates | Postgres-гейты CI | при изменениях server-core/**

`typecheck:all`, `validate:ci` покрывают i18n; в таблице i18n приведён отдельно для явности DoD.

### 1.2 Флаги

- Все новые флаги **default=false** (новое). Шаг онбординга (RoleStep, показывается всегда) при выборе
  роли «разработчик» **явно пишет `devspace.v1=true`** (D1) как пользовательскую настройку; `defaultValue`
  флага остаётся `false`. Ручное выключение пользователем флаг **никогда не перезаписывается**.
- Регистрация флагов: `packages/core/src/platform/workbench/flags.ts`
  (`WORKBENCH_FLAG`, `WORKBENCH_FEATURE_FLAGS`), доп. экраны —
  `packages/core/src/platform/workbench/extra-screen-flags.ts` (`EXTRA_SCREEN_FLAG`).
- Рендерер-атомы: `apps/electron/src/renderer/atoms/{mode-flags,extra-screens,unified-shell}.ts`
  и новый `apps/electron/src/renderer/atoms/dev-space.ts`
  (`atomWithStorage`), ключи — `apps/electron/src/renderer/lib/local-storage.ts`.
- Канонические id (новое, форма — по существующему паттерну точечных id):
  - `devspace.v1` — мастер-флаг Developer Space (без зависимостей);
  - `devspace.ingest.v1` — ингест репо (клон/привязка/freshness); зависит от `devspace.v1`;
  - `devspace.tools.v1` — шесть инструментов-адаптеров; зависит от `devspace.v1`;
  - `devspace.questions.v1` — блоки вопросов; зависит от `devspace.v1`;
  - `devspace.tours.v1` — динамические туры + демо-режим; зависит от `devspace.v1`;
  - `devspace.ask.v1` — «свой вопрос»; зависит от `devspace.v1`;
  - `playbooks.v1` — поверхность Playbooks (без зависимостей);
    `playbooks.knowledge.v1`, `playbooks.codebook.v1` — зависят от `playbooks.v1`.
  Каноническое направление зависимостей: суб-флаги — от своего master
  (`dependencies: ['devspace.v1']` для
  `devspace.ingest.v1`/`devspace.tools.v1`/`devspace.questions.v1`/`devspace.tours.v1`/`devspace.ask.v1`;
  `dependencies: ['playbooks.v1']` для `playbooks.knowledge.v1`/`playbooks.codebook.v1`),
  master-флаги `devspace.v1` и `playbooks.v1` — без зависимостей.
- Nudge-ключ: `rox.devspace.nudge.v1` — одноразовое напоминание при «мягком сигнале» (без автовключения).
- Убрать устаревшие `workbench.dev-space.v1`, `workbench.onboarding.role.v1` и расхождение дефолтов.
- Каждый флаг: `rollbackSafe: true`; выключение = скрытие пунктов/экранов, данные сохраняются.

### 1.3 Shared-file ownership

Волны идут последовательно, поэтому один shared-файл физически правит только один PR волны за раз.
Ключевой приём: **владение shared-файлом закреплено за одной волной**; если файл нужен позже,
владелец заранее заводит необходимые записи/типы за флагом (`default=false`), а последующие волны
меняют только собственные (не-shared) файлы. См. таблицу §4.

Пример: `nav-destinations.ts`, `settings-registry.ts`, `channels.ts` правит **только В1** — она
заводит и пункт «Разработчикам» (D2), и пункт «Плейбуки» (D12), и все новые channel-id, все за
флагами; В2–В5 эти файлы не трогают.

### 1.4 Процесс

- Пак — в `docs/specs/<date>-<slug>/`; RX-id резервируются на старте В1 (§5); i18n 12 локалей
  (`packages/shared/src/i18n/locales/*.json`, RU-дефолт, ASCII-sorted).
- Каждый PR: зелёные гейты §1.1; коммит-сообщение с RX-id (§5.3); bump не делается вручную без
  отдельного решения.

### 1.5 Примечание к брифу

`00-BRIEF.md` §3.2 исправлен 2026-10-09; канонический путь `apps/electron/src/shared/settings-registry.ts`.
`SETTINGS_PAGES` — в этом файле; `SETTINGS_PAGE_COMPONENTS` — в
`apps/electron/src/renderer/pages/settings/settings-pages.ts`, `SETTINGS_ITEMS` — в
`apps/electron/src/shared/menu-schema.ts` (совпадает с брифом).

---

## 2. Волны

### В1 — Роль + флаги + пространство + клонирование (D1, D2, D3, D14)

**Цель:** онбординг-шаг «Кто вы?» с онбординг-дефолтом dev space; верхнеуровневый пункт
«Разработчикам» с каталогом репо и репо-пространством; ингест репо (клон GitHub / привязка папки /
ручная freshness-кнопка). LLM и инструменты ещё не подключены — это скелет и гейтинг.

**Задачи:**
1. Шаг онбординга «Кто вы?» (разработчик + смежные роли) после имени; скип безопасен, ветки
   `git-bash`/`rox-connect` не ломаются (D1). «Мягкие сигналы» → только напоминание, без автовключения.
2. Регистрация флагов §1.2 (кроме `devspace.tools.v1` и дальше — stub `false`); рендерер-атомы
   и ключи `local-storage.ts`.
3. Новая nav-назначение «Разработчикам» (rail/nav) + предрегистрация «Плейбуки» за флагом;
   страница-каталог репо и репо-пространство; диплинки/вкладка из Проекта (одно ядро, две точки
   входа, D2).
4. Настройки → «Разработчикам» (карточка-тумблер) + предрегистрация страницы Playbooks; рендер
   тумблеров по образцу `ExtraScreensSettings.tsx`/`WorkbenchChromeSettings.tsx`.
5. RPC-контур ингеста (новое): clone по ссылке в `projects/<slug>`; привязка локальной папки;
   freshness/обновление (ручное, паттерн freshness code-intelligence, D3); GitHub device-login
   переиспользуется, токен в рендер не выходит. Clone API — **новое** (в репозитории нет).
6. Регистрация всех новых channel-id в `packages/shared/src/protocol/channels.ts` (для последующих волн).
7. i18n-ключи (12 локалей) для нового шага, пунктов, страниц, состояний.

**Файлы:**
- Существующие (расширение): `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx`;
  `apps/electron/src/renderer/hooks/useOnboarding.ts`; `packages/shared/src/environment/types.ts`,
  `packages/shared/src/environment/storage.ts`; `packages/core/src/platform/workbench/flags.ts`;
  `packages/core/src/platform/workbench/extra-screen-flags.ts`;
  `apps/electron/src/renderer/atoms/{mode-flags,extra-screens}.ts`;
  `apps/electron/src/renderer/lib/local-storage.ts`;
  `apps/electron/src/renderer/components/app-shell/nav-destinations.ts`;
  `apps/electron/src/shared/settings-registry.ts`;
  `apps/electron/src/renderer/pages/settings/settings-pages.ts`;
  `apps/electron/src/shared/menu-schema.ts`;
  `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` (потребитель навигации);
  `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (аддитивная регистрация пункта — канон 6);
  `apps/electron/src/renderer/platform/ActivityRail.tsx` (аддитивная регистрация пункта/флагов — канон 6);
  `packages/shared/src/protocol/channels.ts`;
  `packages/shared/src/i18n/locales/*.json` (12 локалей).
- Новые (кандидаты): server RPC `packages/server-core/src/handlers/rpc/dev-space.ts` + файлы ингеста;
  типы `packages/shared/src/dev-space/types.ts`; рендерер-атом `apps/electron/src/renderer/atoms/dev-space.ts`;
  расширение GitHub-контура `packages/server-core/src/workgraph/github-oauth-import.ts` (clone);
  хранение репо `projects/<slug>` (специфицируется в 02-SPEC-foundations, O4);
  страницы `apps/electron/src/renderer/pages/dev-space/DevSpaceHomePage.tsx`,
  `apps/electron/src/renderer/pages/dev-space/DevSpaceRepoPage.tsx`,
  `apps/electron/src/renderer/pages/settings/DeveloperSettingsPage.tsx` (и страница Playbooks-stub);
  онбординг-компонент шага «Кто вы?».

**Флаги:** `devspace.ingest.v1`, `devspace.v1`; предрегистрация `playbooks.v1` (=false).
**Телеметрия:** инфраструктура поднимается в В1 (по 02-SPEC-foundations §12); события волн подключаются
по мере реализации (канон 10).
**Зависимости:** нет (первая волна).
**DoD:**
- Гейты §1.1 полностью (включая product-tour-native — renderer).
- unit: онбординг-машина (роль→дефолт флага), гейтинг флагов; server: ингест (clone/bind/freshness,
  отказ при отсутствии сети/токена); renderer: пункт навигации, каталог, тумблер.
- Приёмка: `ONB`, `DEV`, `ING`, `I18N`, `A11Y`.
- Флаги `defaultValue=false`; онбординг-выбор «разработчик» явно пишет `devspace.v1=true` (D1);
  ручное выключение никогда не перезаписывается.
**Риски:** нет clone API (§5, п.3 брифа); `shell:exec` 20 s — для clone использовать job-паттерн, не `shell:exec`
(§3.8, R1/O3); не сломать существующие ветки онбординга.

---

### В2 — Шесть инструментов/артефакты + рендер-поверхности (D4, D5, D6, D7)

**Цель:** адаптеры шести инструментов, каскад генерации (структурные артефакты локально сразу,
LLM-слой фоном с прогрессом), локальное хранение артефактов с provenance и рендер-поверхности
репо-воркспейса (адаптация RC-01..12, 04-UI-SPEC).

**Задачи:**
1. Ревизия решения поверх `CI-DEC-EXTEND-EXISTING-01`: шесть адаптеров `openwiki`, `Understand-Anything`,
   `codegraph`, `archify`, `graphify`, `Groma.md`; `alwaysOn=false`, без демонов; согласовать
   `REJECTED_CODE_INTEL_TOOLS`/`SELECTED_CODE_INTEL` и гэп `CURRENT_SOURCE_CONFLICT` (D4, O1, O2, O7).
2. Каскад (D5): структурные артефакты (codegraph/groma/graphify/archify) — сразу; LLM-слой (wiki,
   «понимание») — фоном, UI показывает скелет.
3. Артефакты (D7): источник правды — корень `projects/<slug>/dev-space/` (`manifest.json`,
   `consent.json`, `audit.jsonl`, `runs/`, `wiki/`, `understanding/`, `code-graph/`, `diagrams/`, `knowledge-graph/`,
   `c4/`, `questions/`, `tours/`, `security/`, `audio/`; JSON/MD/SVG) с provenance;
   публикация человекочитаемых страниц в Notes/Pages (markdown-пайплайн `content:*`, wikilinks).
4. Per-repo согласие + эгресс (D6): модельные коннекты, сеть для CVE/OSV и обновлений инструментов;
   дефолтные исключения `.env*`, `**/*.pem`, `**/*.key`, `**/.codegraph/**`; аудит-лог.
5. Рендер-поверхности репо-воркспейса: wiki-reader, понимание, граф кода, схемы, knowledge-graph,
   C4/OKF (адаптация RC-01..12).
6. Кнопки freshness/обновление артефактов + бейдж «устарело» (после В1-контура).
7. Session-tools агента (В2): `devspace.read`, `devspace.search`, `devspace.propose`
   (`packages/session-tools-core/src/handlers/dev-space-*.ts`); образец — «паттерн knowledge_*».

**Файлы:**
- Существующие (расширение): `packages/shared/src/code-intelligence/types.ts`
  (`CodeIntelAdapter`, `SELECTED_CODE_INTEL`, `REJECTED_CODE_INTEL_TOOLS`);
  `packages/shared/src/code-intelligence/provider.ts` (`CI-DEC-EXTEND-EXISTING-01`, реестр);
  `packages/shared/src/code-intelligence/local-adapter.ts`;
  `packages/shared/src/code-intelligence/refs.ts` (freshness, `rox-code:v1:` refs);
  `packages/server-core/src/handlers/rpc/code-intelligence.ts` (PREVIEW/BIND/CAPTURE/…, `dataEgress:'deny'`);
  `apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx`;
  `packages/shared/src/i18n/locales/*.json`.
- Новые (кандидаты): адаптеры `packages/shared/src/code-intelligence/adapters/*` (или
  `packages/server-core/src/devspace/adapters/*`); job-обвязка анализа (движок — по 02-SPEC-foundations, O3);
  session-tools `packages/session-tools-core/src/handlers/dev-space-*.ts`;
  страницы `apps/electron/src/renderer/pages/dev-space/*` (wiki/граф/схемы/KG/C4); слой ингеста OSV.

**Флаги:** `devspace.tools.v1` (расширение контура флагов — регистрация id сделана в В1).
**Зависимости:** В1 (пространство, флаги, каналы, freshness-кнопка).
**DoD:**
- Гейты §1.1 (renderer → product-tour-native).
- unit: реестр/адаптеры, каскад, provenance-гварды (`explainer.ts`); server: RPC артефактов,
  per-repo согласие/эгресс (`dataEgress:'deny'` по умолчанию, аудит-лог); renderer: поверхности.
- Публикация артефактов проверяется round-trip через `content:*` (commit receipt).
- Session-tools `devspace.read`/`devspace.search`/`devspace.propose` — unit + доступы под флагом.
- Приёмка: `ART`, `PIPE`, `SEC` (эгресс/приватность), `DEV` (поверхности), `I18N`, `A11Y`.
**Риски:** стабильность/пины инструментов на момент старта (O7); выбор канонического codegraph (O1);
схлопывание groma↔archify (O2); стоимость LLM против «предрендерить всё» (R10); `dataEgress`.
**Специально:** длинные пайплайны не через `shell:exec` (§3.8, R1).

---

### В3 — Блоки вопросов + туры/демо-режим + свой вопрос (D8, D9, D10, D11)

**Цель:** предгенерация трёх блоков вопросов, динамические туры по поверхностям dev space с
демо-режимом, свободный чат «свой вопрос» под блоками.

**Задачи:**
1. Блоки вопросов (D8): 10 вопросов на блок (обучение / фичи-имплементация / безопасность+зависимости+
   производительность); пересчёт при новом снапшоте; «почему этот вопрос» (онбординг-профиль +
   репо-контекст + рабочие сигналы). Политика dirty-snapshot — по O8 (по умолчанию пересчёт по команде).
2. Блок 3: SBOM (`syft`, optional runner, `sbom.ts`) + CVE (OSV) под per-repo согласием.
3. Туры (D9): динамические `TourDefinition` из артефактов; новые `TargetId`/`RouteKey`/`TriggerId`/
   `CapabilityId`; попадание в динамический источник каталога; цели через `useTourTarget`; «шаг N/M».
4. Демо-режим (D10): краевая радиальная виньетка (z-токен `z-tour-vignette`, 0.10–0.18), «дыхание»
   4–6 с, пульс границы цели, прогресс-полоса, пауза/выход; `prefers-reduced-motion` → статичный градиент.
5. «Свой вопрос» (D11): композер как `ChatPage` (пикер модели/коннекта, вложения) → обычная сессия,
   привязанная к репо; кнопка «Показать на экранах» → запуск сгенерированного тура.

**Файлы:**
- Существующие (расширение): `apps/electron/src/renderer/features/product-tour/contracts/index.ts`;
  `.../catalogue/product-tour-catalogue.ts`, `.../catalogue/validate.ts`; `.../runtime/routes.ts`,
  `.../runtime/hooks.tsx`, `.../runtime/ProductTourProvider.tsx`, `.../ui/SpotlightOverlay.tsx`,
  `.../ui/TourPopover.tsx`, `.../ui/target-registry.ts`;
  `packages/shared/src/code-intelligence/sbom.ts` (`runSyftSbom`);
  `apps/electron/src/renderer/pages/ChatPage.tsx`,
  `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`,
  `apps/electron/src/renderer/components/app-shell/input/{ChatInputZone,InputContainer,FreeFormInput,CompactModelSelector}.tsx`;
  `apps/electron/src/renderer/hooks/useSessionModelCatalog.ts`;
  `packages/ui/src/styles/tokens/z.css` (новый z-токен `z-tour-vignette` — расширение, канон 9);
  `packages/ui/src/styles/index.css` (keyframes «дыхание» — расширение, канон 9).
- Новые (кандидаты): генератор блоков вопросов (server/core); источник динамических туров;
  UI-блок блоков вопросов и колонки вопросов в репо-пространстве; SBOM/OSV-джоба.

**Флаги:** `devspace.questions.v1`, `devspace.tours.v1`, `devspace.ask.v1`.
**Зависимости:** В1, В2 (артефакты — источник туров и вопросов).
**DoD:**
- Гейты §1.1 (renderer → product-tour-native; `test:product-tour` дополнительно).
- unit: core product-tour (переходы, гвард «verified не из ui-observation»), генератор вопросов,
  dirty-policy; server: SBOM/OSV под согласием; renderer: виньетка/пульс/reduced-motion, композер,
  «шаг N/M».
- Приёмка: `QST`, `TOUR`, `CHAT`, `SEC` (SBOM/CVE-эгресс), `I18N`, `A11Y`.
**Риски:** интеграция с существующим движком продукт-тура без нового движка (D9); корректный демо-режим
под `prefers-reduced-motion` (статичный градиент); эгресс OSV под per-repo (D6).

---

### В4 — Playbooks: Знания (D12, D13)

**Цель:** ноутбук-поверхность «Плейбуки» в режиме знаний: загрузка источников, вопросы по ним,
пресет-вопросы, подкаст в один клик (сценарий LLM, TTS, сборка, плеер, экспорт). Порт концепций
SurfSense на наши примитивы (без вендоринга кода).

**Задачи:**
1. Пункт «Плейбуки» и поверхность-ноутбук (nav/settings предрегистрированы в В1 за флагом).
2. Источники: переиспользование `source-index` (FTS5) и фасада; вопросы по источникам;
   пресет-вопросы.
3. Подкаст v1 (D13): двухголосый диалог (ведущий+эксперт), редактируемые шаблонные роли;
   сценарий — LLM; озвучка существующими TTS (`edge`, `system`); сегменты → сборка в один файл
   (ffmpeg через существующие spawn-паттерны); плеер + экспорт `mp3`/`srt` (O6 — srt по умолчанию да).
   Новый канал `podcast:JOB` (`voice:JOB` остаётся для диктовки/ASR).
4. Устранение коллизии имени (D12): видимый ярлык SessionWorkbench «playbook holes» → «Веера задач».
5. Per-repo/сессионный эгресс для LLM-сценария — по правилам D6.

**Файлы:**
- Существующие (расширение): `packages/server-core/src/sources/source-index.ts`,
  `.../sources/source-index-facade.ts`, `.../sources/source-index-watch.ts`;
  RPC `sources:REINDEX|SEARCH|STATUS`; `apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx`;
  `packages/shared/src/voice/{types,capabilities,contracts}.ts`;
  `packages/shared/src/voice/adapters/edge-tts.ts`;
  `packages/server-core/src/handlers/rpc/system-tts.ts`;
  `packages/shared/src/voice/job-machine.ts`, `packages/shared/src/voice/host.ts`;
  `apps/electron/src/renderer/lib/message-tts.ts`;
  `packages/shared/src/i18n/locales/*.json` (переименование ярлыка + новые строки).
- Новые (кандидаты): страницы/компоненты `apps/electron/src/renderer/pages/playbooks/*`;
  RPC ноутбука/подкаста; пайплайн подкаста (сегменты→ffmpeg→файл) — **новое** (мультиспикера/
  миксдауна нет, §3.7); генератор сценария.

**Флаги:** `playbooks.v1`, `playbooks.knowledge.v1` (режим знаний, включая подкаст v1).
**Зависимости:** В1 (nav/settings/флаги/каналы). Не зависит от В2/В3 (можно вести параллельно по коду,
но PR сливается после В3 согласно порядку D14).
**DoD:**
- Гейты §1.1 (renderer → product-tour-native при изменениях renderer/**).
- unit: индексация источников/retrieval (в т.ч. ts-fallback при отсутствии bun:sqlite, R2), машина
  джобов TTS, сборка сегментов; server: RPC ноутбука/подкаста; renderer: плеер, экспорт.
- Приёмка: `PLB`, `POD`, `SEC`, `I18N`, `A11Y`.
**Риски:** `source-index` под чистым Electron/Node требует ts-fallback (R2); нет мультиспикера/миксдауна
(R4); лицензия SurfSense — только порт концепций (R5); коллизия имени (R6); SiYuan выключен — не
строить на нём (R7).
**Вне v1 в этой волне:** Kokoro как TTS-движок (O5 → v1.x, опционально); N-агентный подкаст (v1.x).

---

### В5 — Кодбук (D12)

**Цель:** режим **кодбука** Playbooks — ноутбуки-пайплайны по коду, поверх артефактов и сессий.

**Задачи:**
1. Кодбук-ноутбук: ячейки-пайплайны по репо (переиспользование артефактов В2 и поверхностей В4).
2. Реюзуализация агентских сессий, привязанных к репо; исполнение шагов через существующие
   spawn-паттерны/джоб-движок (O3), не через `shell:exec` (§3.8).
3. Экспорт/шаринг ноутбука (в объёме, согласованном 02/03/04); i18n.

**Файлы:**
- Существующие (расширение): оболочка ноутбука Playbooks из В4; RPC сессий/запусков;
  `packages/shared/src/i18n/locales/*.json`. Контракт `packages/shared/src/code-intelligence/*`
  расширен в В2; В5 использует его **без изменений**.
- Новые (кандидаты): страницы/исполнитель `apps/electron/src/renderer/pages/playbooks/codebook/*`;
  RPC запуска пайплайна кодбука.

**Флаги:** `playbooks.codebook.v1`.
**Зависимости:** В1, В4 (оболочка ноутбука); по данным — В2 (артефакты).
**DoD:**
- Гейты §1.1 (renderer → product-tour-native).
- unit: исполнитель шагов/пайплайна; server: RPC запуска и хранение; renderer: ноутбук.
- Приёмка: `CBK`, `SEC`, `I18N`, `A11Y`.
**Риски:** длительные пайплайны (R1/O3); последовательность PR после В4.

---

## 3. Порядок проверки (какие acceptance-уровни в каждой волне)

| Волна | unit | renderer | server | native | Особые |
|---|---|---|---|---|---|
| В1 | онбординг/флаги | навигация/каталог/тумблер | ингест (clone/bind/freshness) | product-tour-native (macOS/Windows) | rx:validate, i18n |
| В2 | адаптеры/каскад, session-tools | поверхности репо | RPC артефактов, эгресс | product-tour-native | round-trip `content:*`, приёмка `PIPE` |
| В3 | core product-tour, генератор Q | виньетка/туры/композер | SBOM/OSV | product-tour-native; `test:product-tour` | reduced-motion |
| В4 | source-index, TTS-джобы | плеер/экспорт | RPC ноутбука/подкаста | — (нет новых renderer-туров) | проверка ts-fallback |
| В5 | исполнитель | ноутбук кодбука | RPC запуска | — | — |

Общие команды: `bun run validate:ci`, `bun run typecheck:all`, `bun run lint:ui-tokens`,
`bun run rx:validate`; renderer-волны — `bun run test:product-tour:native`. Уровни приёмки
(`unit`/`renderer`/`server`/`native`) соответствуют разделам `06-acceptance-cases.json`.

---

## 4. Таблица «волна → shared files → владелец»

| Shared file | Что меняется | Владелец (волна) | Правило |
|---|---|---|---|
| `apps/electron/src/renderer/components/app-shell/nav-destinations.ts` | «Разработчикам» (D2) + предрегистрация «Плейбуки» (D12) | **В1** | В2–В5 не трогают |
| `apps/electron/src/shared/settings-registry.ts` | страницы настроек «Разработчикам», Playbooks | **В1** | В2–В5 не трогают |
| `apps/electron/src/renderer/pages/settings/settings-pages.ts` | компоненты новых страниц настроек | **В1** | В2–В5 не трогают |
| `apps/electron/src/shared/menu-schema.ts` | `SETTINGS_ITEMS` (производная) | **В1** | В2–В5 не трогают |
| `packages/shared/src/protocol/channels.ts` | все новые channel-id всех волн | **В1** | последующие волны добавляют только обработчики, не registry |
| `packages/core/src/platform/workbench/flags.ts` | регистрация всех новых флагов | **В1** | В2–В5 меняют только `defaultValue` при включении по гейту (сериализация) |
| `packages/core/src/platform/workbench/extra-screen-flags.ts` | доп. экранные флаги | **В1** | В2–В5 не трогают |
| `apps/electron/src/renderer/atoms/{mode-flags,extra-screens}.ts`, `.../atoms/dev-space.ts` | атомы флагов | **В1** | В2–В5 не трогают |
| `apps/electron/src/renderer/lib/local-storage.ts` | ключи storage | **В1** | новые ключи — за владельцем; сериализация по волнам |
| `apps/electron/src/renderer/features/product-tour/contracts/index.ts` | новые union-члены (D9) | **В3** | В1/В2 не трогают; при необходимости — сериализация до В3 |
| `apps/electron/src/renderer/features/product-tour/catalogue/*`, `runtime/*`, `ui/*` | динамические туры/демо | **В3** | В2 не трогает |
| `packages/shared/src/code-intelligence/{types,provider,refs,sbom}.ts` | ревизия решения, 6 адаптеров, SBOM | **В2** | В3 использует `sbom.ts` без изменения контракта |
| `packages/server-core/src/handlers/rpc/code-intelligence.ts` | расширение RPC | **В2** | В5 использует без изменения контракта |
| `packages/shared/src/i18n/locales/*.json` (12) | новые строки | **по волнам (сериализация)** | один PR волны за раз; parity/sorted/coverage в каждом |
| `package.json` | scripts/deps | **по волнам (сериализация)** | только текущая волна, PR не параллельны |
| `packages/shared/src/voice/*` | TTS-пайплайн подкаста | **В4** | В5 не трогает |

Правило сериализации: волны сливаются строго по порядку (D14); PR следующей волны открывается только
после merge предыдущей, поэтому параллельной правки одного shared-файла не возникает.

---

## 5. RX-план

### 5.1 Домены и следующий свободный номер (на момент `0c918497d`, registry/rx-registry.yaml)

Числа ниже — следующий свободный номер по домену (max+1; нумерация последовательна, не переиспользуется,
дыры допустимы — `RX-LEGEND.md` §6). Резервирование выполняется **на старте В1** одним коммитом
(append в `registry/rx-registry.yaml`).

| Домен | Значение (RX-LEGEND §2) | Следующий свободный | Что резервируем |
|---|---|---|---|
| `SPC` | Specification | 0022 | по одной записи на каждый документ пака (8 шт., включая 05-PLAN) |
| `FEA` | Feature | 0001 | Developer Space, Playbooks, Подкаст, Кодбук (по волнам) |
| `SRF` | Surface | 0049 | поверхности/экраны dev space и Playbooks |
| `CMP` | Component | 0069 | UI-блоки (виньетка/демо, блоки вопросов, ноутбук) |
| `INT` | Integration | 0036 | 6 инструментов + GitHub clone + OSV + openwiki |
| `API` | API contract | 0013 | новые RPC/каналы (ингест, артефакты, ноутбук, подкаст) |
| `DAT` | Data model | 0017 | артефакты dev space, источник, сценарий подкаста |
| `PLG` | Plugin/Add-on | 0013 | внешние инструменты-аддон (если применимо) |
| `AUT` | Automation | 0031 | пайплайны анализа/генерации |
| `PIP` | Pipeline CI/CD | 0201 | новые/изменённые гейты волн |
| `ADR` | Architecture Decision | 0020 | ревизия D4 (решение), выбор job-движка (O3), правило путей клонов |
| `DOC` | Document section | 0023 | разделы документации по волнам |
| `RSK` | Risk | 0001 | риски §5 (R1–R10) |
| `TSK` | Task | 0001 | задачи волн В1–В5 |
| `SEC` | Security finding | (по номеру из `RX-DOC-0004`) | эгресс/приватность/аудит |

Точные номера фиксируются коммитом резервирования; `O1`/`O2`/`O3` решаются аудитом ревизии D4
(результат — `RX-ADR-*`) и спецификацией foundations.

### 5.2 Привязка id

- `RX-SPC-*` — front matter (`rx-id:`) документов пака; имена файлов остаются по конвенции пака.
- `RX-FEA-*`/`RX-SRF-*`/`RX-CMP-*`/`RX-INT-*`/`RX-API-*`/`RX-DAT-*`/`RX-AUT-*` — записи реестра
  (id, title RU, kind, path, status, refs).
- `RX-ADR-*` — решения; `RX-RSK-*` — риски; `RX-TSK-*` — задачи волн; `RX-PIP-*` — гейты.
- Маркеры в коде (`// RX-CMP-*`) — только для несущих компонентов (RX-LEGEND §5.5), без распыления.

### 5.3 Коммит-сообщения

Формат (RX-LEGEND §5.4): `<type>(<scope>): <кратко> (RX-<DOMAIN>-<NNNN>)`.
Примеры: `feat(devspace): ингест репозитория по ссылке (RX-API-0013)`,
`feat(playbooks): сборка подкаста из сегментов (RX-AUT-0031)`,
`chore(rx): reserve pack ids (RX-SPC-0022)`. Один PR волны содержит коммиты с id своей волны.

---

## 6. Вне v1 / v1.x

- **webui** — вне v1 (D14); приёмка только native, Linux = NOT_RUN (R9).
- **Авто-watch/pull репозиториев** — не в v1 (D3); только ручная freshness/обновление.
- **Авто-регенерация артефактов** — не в v1 (D7).
- **N-агентный подкаст** (произвольные роли) — v1.x; v1 = два голоса из фиксированного реестра (D13).
- **Kokoro как TTS-движок** — v1.x, опционально (D13, O5).
- **Интеграция `deepwiki-open`** — не обязательна (D5); референс UX, не компонент.
- **Вендоринг SurfSense как сайдкар-сервиса/форк кода** — не выбираем (D12, R5); только порт концепций.
- **Построение Playbooks на SiYuan** — исключено (R7; `KnowledgeSurfacePage.tsx` жёстко выключен).
- **Молчаливый эгресс** — исключён (D6): только per-repo согласие, аудит-лог.
- **Мультиспикерный миксдаун вне подкаста** — не в объёме (R4).

---

## 7. Открытые вопросы, влияющие на план

- **O1** (канонический codegraph) и **O2** (groma↔archify) — блокируют финализацию реестра адаптеров в В2.
- **O3** (job-движок) — фиксируется в 02-SPEC-foundations; влияет на В1 (clone), В2 (генерация), В5 (пайплайны).
- **O4** (где хранить клоны) — рекомендация: `projects/<slug>` как репо-проект; влияет на пути В1/В2.
- **O5** (Kokoro) — объём В4; по умолчанию v1.x.
- **O6** (srt) — v1: да.
- **O7** (пины/лицензии 6 инструментов) — фиксируются на старте В2.
- **O8** (dirty snapshot) — по умолчанию пересчёт блоков по явной команде (В3).