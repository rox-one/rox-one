# 03-SPEC-features — функциональные подсистемы Developer Space и Playbooks

Статус: техническая спецификация. Основание — `00-BRIEF.md` (решения D4, D5, D8–D13). Платформенные
вопросы (гейтинг, IA, ингест, джобы, артефакты/хранение, эгресс, агентский доступ, флаги, i18n) —
в `02-SPEC-foundations.md`; здесь только функциональные подсистемы и их контракты.

Обозначения: **«новое»** — сущность/контракт, которых в коде нет; **«расширение»** — изменение
существующего контракта; пути к существующему коду даны по карте фактов брифа (§3).
**Обновление 2026-10-10:** все `TODO(open)` O1–O11 закрыты — статусы и решения в `07-DECISIONS.md`
(в частности O1 = CodeGraphContext, а не ColbyMcHenry).

---

## 1. Реестр адаптеров инструментов (D4)

Принцип: **одна операция — один инструмент**. Операции совпадают с уже существующим словарём
`CodeIntelligenceOperation` из `packages/shared/src/code-intelligence/provider.ts` (`'symbols' | 'sbom'
| 'search' | 'repo-wiki' | 'diagram' | 'source-graph' | 'c4'`); он **расширяется** двумя значениями
(см. ниже) в рамках новой ревизии решения.

### 1.1 Таблица адаптеров

| Операция | Инструмент | Входы | Выходы → артефакты (в `projects/<slug>/dev-space/…`, D7) | Поверхность UI | Пин / лицензия |
|---|---|---|---|---|---|
| `repo-wiki` (генерация + чтение) | `langchain-ai/openwiki` | клон репо `projects/<slug>`; локальный агентный CLI (Node≥22.22) + MCP | markdown-страницы + Mermaid + кросс-ссылки → `dev-space/wiki/**` (kind `wiki`) | Wiki reader, Wiki generation plan/review (RC-03/04/05) | v0.6.1, MIT, `fab24e77…` |
| `learning` (**новое** значение операции) | `Egonex-AI/Understand-Anything` | клон репо; вендоренный skill `apps/electron/resources/skills/understand-anything/**` | `.ua/knowledge-graph.json` + обучающие материалы/туры → `dev-space/understanding/**` (kind `understanding`) | «Понимание» (дашборд skill `understand-dashboard`) | @1d7418b8, MIT |
| `symbols`, `search`, `source-graph` | `ColbyMcHenry/codegraph` | клон репо; Rust+TS CLI, `codegraph serve --mcp` | SQLite `.codegraph/codegraph.db` (FTS5) → символы/вызовы в `dev-space/code-graph/**` (kind `code-graph`) | Code search (RC-07), grounded answer (RC-08) | MIT; **TODO(open) O1** — канонический провайдер |
| `diagram` | `tt-a1i/archify` | типизированный JSON IR (строится из артефактов) | SVG/PNG-схемы → `dev-space/diagrams/**` (kind `diagram`) | Diagram (RC-06) | MIT; agent-skill |
| `knowledge-graph` (**новое** значение операции) | `Graphify-Labs/graphify` | клон репо; Python tree-sitter `/graphify`; вендоренный `gstack graphify-adapter` | `graphify-out/{graph.html,GRAPH_REPORT.md,graph.json}` → `dev-space/knowledge-graph/**` (kind `knowledge-graph`) | Knowledge-graph viewer | Apache-2.0 |
| `c4` | `MrLesk/Groma.md` | клон репо; локальная генерация без AI, npm `groma.md` | `groma/` markdown **OKF 0.2** (C4) + static export → `dev-space/c4/**` (kind `c4`) | Groma architecture (RC-10) | v0.6.0, MIT, `46b1572d…` |
| `sbom` | `syft` (optional runner) | клон репо | SBOM → `dev-space/security/sbom.*` (kind `sbom-cve`) | Блок вопросов 3 | существующий `packages/shared/src/code-intelligence/sbom.ts` (`runSyftSbom`, никогда не устанавливает) |

`sbom` — не из «шести инструментов» D4, а существующий код-интеллект-провайдер (`SELECTED_CODE_INTEL`
= `['local-fs-symbols', 'syft-sbom']`), переиспользуется для блока безопасности.

Раскладка (канон, `02-SPEC-foundations.md` §7): артефакты всех инструментов складываются в
`projects/<slug>/dev-space/` — `wiki/`, `understanding/`, `code-graph/`, `diagrams/`, `knowledge-graph/`,
`c4/`, `questions/`, `tours/`, `security/`, `audio/` (+ `manifest.json`, `consent.json`, `audit.jsonl`, `runs/`).
`manifest.json` помечает каждый артефакт `kind` из
`wiki|understanding|code-graph|diagram|knowledge-graph|c4|questions|tour|sbom-cve|audio`.

### 1.2 Правила ревизии решения D4

- Выпускается **новая ревизия** поверх `CI-DEC-EXTEND-EXISTING-01`
  (`packages/shared/src/code-intelligence/provider.ts`, `CODE_INTELLIGENCE_SELECTION_REVISION`).
  Текущий `REJECTED_CODE_INTEL_TOOLS` (`packages/shared/src/code-intelligence/types.ts`) отвергает
  `Graphify` (`unmaintained-duplicate-graph`) и `Archify` (`unmaintained-duplicate-graph`); ревизия
  обязана снять эти два rejection с обоснованием «текущая активность проектов», оставив `CodeWiki`/
  `DeepWiki` отвергнутыми (`duplicate-wiki-daemon`, D5 — deepwiki-open не берём).
- Ревизия обязана **согласовать `CI-G-08 CURRENT_SOURCE_CONFLICT`**: каталог capabilities
  (`packages/shared/src/capabilities/packs.ts`) объявляет `codewiki`/`deepwiki`/`understand-anything`/
  `codegraph`/`graphify`/`archify` как «available» с placeholder-репозиториями `sourceRepo: 'example/*'`
  (строки 92–133) и **неверными placeholder-лицензиями** (`understand-anything` — `Apache-2.0` вместо
  реальной MIT; `graphify` — `MIT` вместо реальной Apache-2.0). Ревизия обязана заменить placeholder-адреса
  реальными пинами из §4 брифа, `openwiki`/`groma` — добавить, отвергнутые `codewiki`/`deepwiki` —
  привести к статусу реестра `REJECTED_CODE_INTEL_TOOLS`.
- Расширение словаря операций (значения `learning`, `knowledge-graph`) — часть ревизии: множество
  `OPERATIONS` в `provider.ts` пополняется, `isRejected()` перестаёт блокировать graphify/archify.
- Правила реестра сохраняются: `alwaysOn === false` для всех провайдеров, **без демонов** (провайдер
  регистрируется, но не запускает инструмент — `provider.ts`), on-demand активация только через
  `ProviderRequestContext.enabled` и `allowedProviderIds`, не-базовые провайдеры обязаны нести
  `sourceRevision` + `artifactDigest` (`unverified-provider-manifest`), удалённые провайдеры требуют
  `binding.policy.dataEgress === 'allow'`.
- Финальный аудит схлопывает пересечение groma↔archify (**TODO(open) O2**): если диаграммы
  дублируются, `diagram`-операция остаётся за одним инструментом, второй выводится из реестра.
- Пины/лицензии всех шести инструментов фиксируются на момент старта В2 (**TODO(open) O7**).

---

## 2. Подсистемы по каждому инструменту

Общий паттерн вызова: инструмент = **локальный агентный CLI/MCP**, запускается по запросу как дочерний
процесс/сервер через существующие spawn-паттерны (`packages/shared/src/agent/*`, privileged broker,
extension host — см. §3.8 брифа); `shell:exec` (`apps/electron/src/main/handlers/system.ts:314`,
timeout 20 s) для длинных пайплайнов не используется. Точный job-движок — **TODO(open) O3**;
глубина истории и лимиты клона — **TODO(open) O9** (§02-SPEC-foundations §5).
Вызовы модельных коннектов идут только под per-repo согласием (D6, §02-SPEC-foundations).

### 2.1 openwiki (wiki)

- **Роль:** основной генератор wiki и «понимания» (D5), репо-owned markdown.
- **Как вызывается:** локальный агентный CLI (npm `openwiki`) + MCP-сервер; generation flow — через MCP.
- **MCP-контракты (из брифа §4):** инструменты `openwiki_search`, `openwiki_read`,
  `openwiki_list_workspaces`, `openwiki_list_wikis` + flow генерации. `search`/`read`/`list_*` — read-only
  поверхность для агентов; generation flow инициируется только из UI/джоба.
- **Generation flow (план):**
  1. построение **плана страниц** (структура репо → TOC с приоритетами);
  2. генерация страниц по секциям (LLM-слой, фон, каскад D5 — UI показывает скелет сразу; параллелизм
     LLM-слоя — **TODO(open) O10**, §02-SPEC-foundations §6);
  3. валидация Mermaid (синтаксис каждого блока до коммита в артефакт);
  4. кросс-ссылки (внутри wiki + на символы/диаграммы);
  5. запись в `dev-space/wiki/**` с provenance.
- **Форматы артефактов:** связанный markdown + Mermaid + визуализатор; версионируется в папке проекта.
- **Кэш/инкремент:** генерация инкрементальная — страница пересобирается при изменении её входных
  файлов (по `artifactDigest`/`sourceRevision` снапшота, аналогично `provider.ts`), неизменённые страницы
  берутся из кэша. Авто-регенерация не в v1 (D7) — пересчёт по кнопке при новом снапшоте.
- **Mermaid-валидация:** обязательный шаг перед публикацией; невалидный блок не попадает в артефакт.
- **Surface:** Wiki reader (RC-03), Code search (RC-07), grounded answer (RC-08); публикация в Notes/Pages — D7.
- **Ограничения:** Node≥22.22; требует локальной модели либо коннекта под consent; репо-owned (нет
  серверного демона).
- **Пин/лицензия:** v0.6.1, MIT, `fab24e77…` (закрепить в ревизии D4, O7).

### 2.2 understand-anything (понимание)

- **Роль:** knowledge-graph понимания репо и обучающие материалы/туры; источник «обучающих» туров (D4).
- **Как вызывается:** вендоренный skill `apps/electron/resources/skills/understand-anything/**`
  (подкоманды `understand`, `understand-explain`, `understand-domain`, `understand-onboard`,
  `understand-dashboard`, `understand-diff`, `understand-chat`, `understand-knowledge`, `understand-figma`).
- **Форматы артефактов:** `.ua/knowledge-graph.json` (граф понимания) + генерируемые обучающие материалы;
  копируются/регистрируются в `dev-space/understanding/**` с provenance.
- **Стык с product-tour:** генерируемые обучающие материалы конвертируются в **динамические
  `TourDefinition`** (§10) и попадают в динамический источник каталога product-tour; статический
  каталог `OBT-01..25` остаётся только для туров по приложению (D9).
- **Surface:** дашборд «Понимание»; обучающие туры через product-tour.
- **Ограничения:** multi-agent → требует LLM-слоя под consent; результат — снапшот, не live.
- **Пин/лицензия:** MIT, @1d7418b8.

### 2.3 codegraph (граф кода)

- **Роль:** символы, вызовы, impact-анализ репо.
- **Как вызывается:** Rust+TS CLI, MCP-режим `codegraph serve --mcp`; артефакт — SQLite
  `.codegraph/codegraph.db` (FTS5). В репо уже есть MCP-каталог `codegraph` (= CodeGraphContext uvx
  0.6.13) — **TODO(open) O1** определяет канонический провайдер.
- **Запросы → поверхности:**

  | Запрос | Питает поверхность |
  |---|---|
  | `symbol` (поиск/чтение определения символа) | Code search (RC-07), grounded answer (RC-08), Source viewer (RC-09) |
  | `callers` | grounded answer, impact в блоках вопросов (фичи/рефакторинг) |
  | `callees` | grounded answer, диаграммы вызовов (`diagram`/`source-graph`) |
  | `impact` (транзитивное влияние изменения символа) | блоки вопросов (фичи/улучшения), drift/review (RC-11) |

- **Форматы артефактов:** нормализованные символы/рёбра → `dev-space/code-graph/**` (JSON) + индекс БД.
- **Ограничения:** `.codegraph/**` входит в дефолтные исключения индексации (D6) — БД не индексируется
  как исходники, но остаётся артефактом; полнота зависит от языка/парсера Rust-билда.
- **Пин/лицензия:** MIT; версия фиксируется ревизией (**O1, O7**).

### 2.4 archify (схемы)

- **Роль:** генерация схем/диаграмм.
- **Как вызывается:** agent-skill (JS), вход — **типизированный JSON IR**, выход — HTML/SVG.
- **Типы диаграмм по умолчанию (новое — список дефолтов):** поток модулей/зависимостей (`module-graph`),
  граф вызовов (`call-graph` из codegraph `source-graph`), последовательность взаимодействия
  (`sequence`), диаграмма состояний (`state`). Тип выбирается по типу артефакта-источника; список — в
  конфиге генератора (**новое**).
- **IR → SVG/PNG:** генерация из JSON IR в SVG; PNG — экспорт (рендер SVG).
- **Экспорт:** SVG/PNG пользователю; сохранение в `dev-space/diagrams/**`.
- **Surface:** Diagram (RC-06), встраивание в wiki.
- **Ограничения:** пересечение с groma по диаграммам — **TODO(open) O2**.
- **Пин/лицензия:** MIT (закрепить в O7).

### 2.5 graphify (knowledge-graph)

- **Роль:** knowledge-graph репо.
- **Как вызывается:** Python tree-sitter, команда `/graphify`; в репо есть вендоренный
  `gstack graphify-adapter` (переиспользуется как адаптер).
- **Выходы:** `graphify-out/graph.html`, `GRAPH_REPORT.md`, `graph.json` → копируются в
  `dev-space/knowledge-graph/**`.
- **Пометки `EXTRACTED`/`INFERRED`:** каждый узел/ребро графа несёт маркер происхождения —
  `EXTRACTED` (из кода/структуры) vs `INFERRED` (LLM-вывод); UI обязан показывать различие, фильтровать
  по нему и не смешивать достоверное с выводом.
- **Поиск:** по графу поверх готового артефакта; интеграция с `knowledge:search`/vault-индексом — через
  публикацию в Notes/Pages (D7), без нового серверного поиска.
- **Ограничения:** Python-рантайм; требует tree-sitter-парсеров; LLM-часть под consent.
- **Пин/лицензия:** Apache-2.0.

### 2.6 groma (C4/OKF)

- **Роль:** C4-архитектура в формате OKF markdown.
- **Как вызывается:** CLI `MrLesk/Groma.md` (npm `groma.md`), локальная генерация **без AI**; skill `groma`
  (`groma agent-instructions`, `--help`).
- **Форматы артефактов:** каталог `groma/` — markdown **OKF 0.2** (C4-модель) + static export (HTML) →
  `dev-space/c4/**`.
- **Viewer:** рендер OKF/C4 в приложении; static export — для шаринга/офлайна.
- **Пересечение с archify (O2):** если ревизия схлопывает — groma остаётся источником C4-структуры, archify
  — рендером диаграмм из IR (или наоборот); решение фиксируется в ревизии.
- **Ограничения:** детерминированная генерация (без AI); требует исходников репо.
- **Пин/лицензия:** v0.6.0, MIT, `46b1572d…`.

---

## 3. Блоки вопросов (D8)

### 3.1 Алгоритм генерации

- Три блока: **обучение**; **фичи/улучшения**; **безопасность/зависимости/производительность**.
- Генерация — по **шаблонам, привязанным к артефактам** (новое): каждая тема шаблона ссылается на тип
  артефакта-источника и операцию:
  - блок 1 — символы/структура (`symbols`), wiki (`repo-wiki`), понимание (`learning`);
  - блок 2 — impact-запросы (`source-graph`), callers/callees, knowledge-graph (`INFERRED`-узлы как
    «что улучшить»);
  - блок 3 — SBOM (`sbom`), CVE, диаграммы зависимостей/производительности.
- **Квота: ровно 10 вопросов на блок** (D8). Развёрнутые «ответы» — по клику: запуск тура (§10) либо
  текст.
- **Каждый вопрос** хранит ссылку на артефакт-источник (path/ref) и обоснование «почему» (§3.2).

### 3.2 Персонализация и «почему»

- Входы персонализации: **онбординг-профиль** (роль/профессия, D1; `EnvironmentPrefs`,
  `packages/shared/src/environment/types.ts`), **репо-контекст** (языки, домены, зависимости из артефактов),
  **рабочие сигналы** (незакоммиченное рабочее дерево, состояние CI).
- Каждый сгенерированный вопрос несёт прозрачную пометку **«почему этот вопрос»** — какие входы
  персонализации и какой артефакт его породили.
- Сигналы рабочего дерева/CI читаются read-only; новые сетевые источники не вводятся.

### 3.3 Пересчёт и снапшоты

- Предгенерация при анализе; **пересчёт при новом снапшоте** (D8) — по существующему паттерну freshness/
  снапшотов code-intelligence.
- Политика «грязного» рабочего дерева — **TODO(open) O8**: по умолчанию пересчёт блоков по явной команде,
  не автоматически.

### 3.4 CVE/SBOM

- Блок 3: SBOM через `syft` (существующий optional runner `sbom.ts`, никогда не устанавливает инструмент),
  CVE — через **OSV** под per-repo согласием (D6/D8).
- Молчаливого сетевого эгресса нет: сеть CVE-проверки включается только при consent.

---

## 4. Туры (D9) — расширение product-tour

Движок не строим: расширяем существующий `apps/electron/src/renderer/features/product-tour/`.

### 4.1 Динамический источник TourDefinition

- Текущий каталог — статический массив `catalogue/product-tour-catalogue.ts` (25 туров OBT-01..25,
  57 шагов), валидация `catalogue/validate.ts`. **Расширение:** вводится динамический источник каталога,
  в который попадают `TourDefinition`, сгенерированные из артефактов репо (§4.2); статика остаётся для
  обучающих туров приложения (D9).
- Цели регистрируются через существующий `useTourTarget(id, options)` (`runtime/hooks.tsx`); источник
  сигналов — `useTourSignals()`.
- **Гвард сохраняется:** сигнал уровня `verified` не может прийти из `origin: 'ui-observation'`
  (`contracts/index.ts`, `TourSignal`). Генерируемые туры используют только разрешённые origins.

### 4.2 Генерация туров из артефактов + вопросов

- Вход: артефакты (§1) + вопросы блоков (§3). Один тур = последовательность шагов, каждый шаг
  привязан к `TargetId` на поверхности dev space/Playbooks.
- `TourDefinition` — существующий контракт (`contracts/index.ts`), но `TourId` сегодня — union
  `OBT-01..25`. **Расширение:** `TourId` расширяется до строкового пространства для динамических туров
  (предлагаемый префикс — **новое**: `DS-<slug>-<n>` для dev space, `PB-<slug>-<n>` для Playbooks).
  Смена union → branded string требует правки `validate.ts` и потребителей каталога.

### 4.3 Новые значения контрактов (все — «новое»)

- **TargetId:** `devspace.repo.overview`, `devspace.wiki.reader`, `devspace.wiki.plan`,
  `devspace.understand.graph`, `devspace.codegraph.search`, `devspace.diagram.canvas`,
  `devspace.kg.graph`, `devspace.c4.viewer`, `devspace.questions.block1`, `devspace.questions.block2`,
  `devspace.questions.block3`, `devspace.chat.composer`, `playbooks.sources.list`,
  `playbooks.questions.presets`, `playbooks.podcast.player`, `playbooks.codebook.cells`.
- **RouteKey:** `devspace`, `devspace-repo`, `playbooks`, `playbooks-source`, `playbooks-codebook`.
- **TriggerId:** `devspace-opened`, `repo-analyzed`, `wiki-ready`, `questions-ready`, `playbooks-opened`,
  `podcast-generated`.
- **CapabilityId:** `devspace.available`, `devspace.artifacts.ready`, `openwiki.available`,
  `understand.available`, `codegraph.available`, `archify.available`, `graphify.available`,
  `groma.available`, `playbooks.available`, `podcast.tts-available`, `podcast.ffmpeg-available`.
- Новые `SignalName` (по необходимости) добавляются с тем же гвардом origin; имена — в PLAN при старте В3.

### 4.4 Прогресс, target-missing, телеметрия

- **Прогресс «шаг N из M»:** сейчас счётчика в прогоне нет — **расширение** UI (`ui/` product-tour),
  данные берутся из `TourProgress.steps` / текущего `TourAttempt.stepId` (существующие контракты).
- **target-missing:** существующий `TargetRegistry.resolve` → `{ status: 'blocked'; reason }` с
  `'target-missing' | 'ambiguous-target' | 'target-occluded'`; шаг объявляет
  `missingTarget: 'block-and-offer-retry-or-pause'` (существующий контракт `TourStep`). Поведение туров
  dev space использует этот же путь, без нового механизма.
- **Персистентность прогонов:** существующая (IndexedDB; `ProgressRepository`), не меняется.
- **Телеметрия:** опираться на существующие evidence-уровни (`acknowledged|observed|verified`) и
  `TourProgress`; отдельный аналитический транспорт в брифе не зафиксирован — **новые каналы не вводим**.

---

## 5. Демо-режим: компонент виньетки (D10)

**Новое:** компонент `TourVignette` в `apps/electron/src/renderer/features/product-tour/ui/`.

- **Назначение:** краевой декоративный слой — тёмная радиальная виньетка по периметру окна.
- **Параметры:** непрозрачность **0.10–0.18**; анимация «дыхание» **4–6 с**; цвет — графит
  (токены `packages/ui/src/styles/tokens/*`).
- **Слои / z-порядок:**
  - существующий spotlight — `z-popover` (=100; `SpotlightOverlay.tsx` использует класс `z-popover`);
  - `scrim` = 200, `modal` = 210 (токены §3.9 брифа);
  - виньетка — **новый z-токен** (предлагается `z-tour-vignette` = 90, **новое**) — **ниже** spotlight,
    **выше** обычного контента; scrim/200 и modal/210 остаются поверх.
- **Токен и keyframes (расширение, волна В3):** z-токен `z-tour-vignette` — в
  `packages/ui/src/styles/tokens/z.css`; keyframes «дыхания» — в `packages/ui/src/styles/index.css`.
- **Пульс границы целевого блока:** анимированная обводка целевого прямоугольника (существующий
  `spotlightRect` из `ui/geometry.ts`); слой пульса — между виньеткой и spotlight.
- **reduced-motion:** при `prefers-reduced-motion` — статичный градиент **без пульса** (токены motion
  обнуляются, `motion-reduce:*`, D10).
- **Прогресс и управление:** прогресс-полоса + «шаг N/M» + кнопки пауза/выход (существующий
  `TourPopover`).
- Существующий spotlight-механизм сохраняется (D10).

---

## 6. Свой вопрос (D11)

- **Композер:** переиспользуется стандартный композер ROX как в `ChatPage`
  (`components/app-shell/ChatDisplay.tsx` → `components/app-shell/input/{ChatInputZone,InputContainer,
  FreeFormInput,CompactModelSelector}.tsx`): пикер модели/коннекта, вложения. Модель-пикер —
  `hooks/useSessionModelCatalog.ts` → `window.electronAPI.getSessionModelCatalog(sessionId)`.
- **Session binding:** запрос уходит в **обычную сессию, привязанную к репо** (D11): сессия видна в списке
  сессий, продолжается, инструменты доступны. Привязка — к репо-контексту dev space (существующий
  механизм сессий/привязок).
- **Кнопка «Показать на экранах»:** в ответе, если ответ ссылается на поверхность/артефакт, доступна
  кнопка запуска **сгенерированного тура** (§4) — прогон динамического `TourDefinition` по dev-space
  поверхностям.
- **Флоу:** ввод вопроса → сессия (repo-bound) → ответ + источники → при наличии — «Показать на экранах»
  → spotlight/демо-режим.

---

## 7. Playbooks — режим знаний (D12)

- **Источники (типы/лимиты):** индексация через существующий `source-index`
  (`packages/server-core/src/sources/source-index.ts`): лимиты **512KB/файл, 32MB суммарно, 2000 файлов**;
  типы — `TEXT_EXTS` (`.md/.mdx/.txt/.json/.jsonl/.yaml/.yml` + исходники + `.csv/.toml/.ini/.sh/.sql` и
  др.); поиск — SQLite FTS5 (`.craft/source-index.sqlite`), при отсутствии bun:sqlite — LIKE-fallback
  (`isSourceIndexFtsAvailable()`); фасад `source-index-facade.ts`, watch `source-index-watch.ts`, RPC
  `sources:REINDEX|SEARCH|STATUS`, UI `SourcesListPanel.tsx`.
- **Заметки:** Notes-источники — через vault-index (`packages/server-core/src/knowledge/vault-index.ts`,
  `knowledge:search`, провайдер `NativeNotesKnowledgeProvider`). SiYuan-поверхность **не используем**
  (`KnowledgeSurfacePage.tsx`, `knowledgeEnabled=false`; риск §5.7).
- **Пресет-вопросы (новое):** набор готовых вопросов поверх источников; отдельная поверхность.
- **Чат с цитатами:** ответы со ссылками на источники (переиспользовать ссылочный механизм
  code-intelligence `CodeCitation`, `refs.ts`).
- **Конспект-артефакты:** публикация итогов в Notes/Pages через `content:*` RPC и block-tree-проекции
  (`packages/core/src/docs/*`), markdown-commit durable receipts (`markdown-commit.ts`).
- **Ограничение:** требование bun:sqlite для FTS5; под чистым Electron/Node — ts-fallback (риск §5.2).

---

## 8. Подкаст (D13) и голос-инфраструктура

### 8.1 Пайплайн

`план → beats → реплики → сегментный TTS → миксдаун ffmpeg → артефакт mp3 (+ srt)`

1. **План** — структура эпизода (LLM, под consent).
2. **Beats** — разбиение на смысловые такты.
3. **Реплики** — реплики по ролям.
4. **Сегментный TTS** — озвучка сегментов существующими движками (§8.3).
5. **Миксдаун ffmpeg** — сборка сегментов в один файл (внешний вызов ffmpeg через существующие
   spawn-паттерны; `shell:exec` не годится, §3.8).
6. **Артефакт** — `mp3` + `srt` (сегменты → тайминги).

### 8.2 Роли/шаблоны

- v1 — **двухголосый** диалог: ведущий + эксперт (D13); роли — редактируемые шаблоны (ярлыки/промпты).
- N агентов с произвольными ролями — **v1.x** (голоса из фиксированного реестра, §8.4).

### 8.3 Движки TTS

- Существующие: `system` (`server-core/src/handlers/rpc/system-tts.ts`, macOS `say`) и `edge`
  (`shared/src/voice/adapters/edge-tts.ts`, CLI pinned 7.2.8; голоса `ru-RU-SvetlanaNeural`/
  `en-US-AriaNeural`; base64 mp3 ≤16MB; evidence `not-sent|possible|sent`).
- **Kokoro** — опциональный третий движок (offline) — **TODO(open) O5**: включать в v1 или v1.x;
  рекомендация — v1.x (объём работ В4).

### 8.4 Голос-инфраструктура

- **Расширение `TtsEngine`:** `packages/shared/src/voice/types.ts` — `TtsEngine = 'system' | 'edge'`
  расширяется значением **`'kokoro'`** (**новое**); `TTS_ENGINES` и `isTtsEngine()` обновляются;
  `VoicePrefs.ttsEngine` совместимость — миграция версии префов (текущая `VOICE_PREFS_VERSION = 3`).
  `SpeakAdapter`/`SpeakResult` (`engine: TtsEngine`) переиспользуются без изменения формы.
- **Реестр голосов (новое):** сейчас голоса edge захардкожены (`ru-RU-SvetlanaNeural`/`en-US-AriaNeural`);
  вводится **фиксированный реестр голосов** (движок → список голосов, язык, пол), из которого
  назначаются роли подкаста и выбираются голоса в v1.x.
- **Статусы/прогресс/отмена:** через джоб-машину (`shared/src/voice/job-machine.ts`,
  `createVoiceJob/advanceJob/applyJobEvent`); **TODO(open) O3** — какой job-движок берём.
- **Пуш статуса — переиспользовать ли `voice:JOB`:** существующий пуш `voice:JOB`/`voice:OVERLAY` с
  монотонным `seq` (`job-machine.ts`, `host.ts`) спроектирован под **capture/dictation** (уровни, оверлей).
  Рекомендация: **отдельный стрим `podcast:JOB`** (**новое**) с тем же монотонным-`seq` дисциплиной,
  потому что подкаст — длинный фоновый рендер с иным жизненным циклом (много сегментов, миксдаун,
  прогресс по сегментам), и смешение с оверлеем диктовки нарушит инвариант монотонности/семантику
  `VoiceHostEvent`. Обоснование зафиксировать в ревизии контракта voice; канал `podcast:JOB` внесён в
  блок новых каналов `02-SPEC-foundations.md` §5.1.
- **Лимиты:** ограничение размера/сегментов эпизода (base64 mp3 ≤16MB на сегмент edge; суммарный бюджет —
  в PLAN); превышение → отказ с понятным сообщением.
- **Плеер + экспорт:** встроенный плеер + экспорт `mp3`/`srt`. Формат `srt` — **TODO(open) O6**
  (по умолчанию да).

---

## 9. Playbooks — кодбук (D12, v1.x)

- **Модель ноутбука (новое):** последовательность ячеек (код/markdown) с сохранением порядка и выходов;
  референс — SurfSense/NotebookLM (порт концепций, не вендоринг — D12).
- **Исполнение:** через job-движок (**TODO(open) O3**), совместимый с длинными пайплайнами (§3.8); не
  `shell:exec`.
- **Сохранение выходов:** stdout/артефакты ячейки сохраняются в ноутбуке и в `dev-space/…`
  (provenance, D7).
- **Связь с dev-space:** ячейки могут ссылаться на артефакты/символы репо (`rox-code:v1:` refs,
  `CodeCitation`); ноутбук-пайплайны по коду используют те же адаптеры (§1).
- **Лимиты/изоляция исполнения** — по платформенным правилам из `02-SPEC-foundations.md`.

---

## 10. Открытые вопросы (O1, O2, O5, O6) и рекомендации

| ID | Вопрос | Рекомендация SPEC |
|---|---|---|
| **O1** | Канонический codegraph-провайдер: `ColbyMcHenry/codegraph` vs `CodeGraphContext` (существующий MCP `codegraph` = uvx 0.6.13). | Решить аудитом ревизии D4; по умолчанию — `ColbyMcHenry/codegraph` (Rust-индекс `.codegraph/codegraph.db`, `serve --mcp`), вторым — отвергнуть как дубль, если проверка подтвердит эквивалентность. |
| **O2** | Схлопывать ли groma/archify (пересечение диаграмм). | Оставить обе операции (`c4`, `diagram`) раздельно, если ревизия подтвердит разный выход (OKF-markdown vs SIR→SVG); иначе `diagram` оставить за одним инструментом, второй вывести из реестра. |
| **O5** | Kokoro — v1 или v1.x. | **v1.x**: в v1 использовать `system`/`edge`; `TtsEngine` расширяем значением `'kokoro'` уже сейчас, движок выключаем до v1.x (по объёму В4). |
| **O6** | Обязателен ли `srt` в v1. | **Да**: генерируется тривиально из сегментов (тайминги сегментов TTS) — стоимость мала, ценность для экспорта высокая. |

---

## 11. Связи документов

- Гейтинг/D1, IA/D2, ингест/D3, джобы/O3, артефакты/D7, эгресс/D6, агентский доступ — `02-SPEC-foundations.md`.
- Экраны поверхностей (RC-01..12), токены/моушн/a11y, z-слои — `04-UI-SPEC.md`.
- Волны В1–В5, файлы, DoD, RX-план — `05-PLAN.md`.
- Машиночитаемые кейсы — `06-acceptance-cases.json`.
- Альтернативы решений D4/D5/D8–D13 — `07-DECISIONS.md`.