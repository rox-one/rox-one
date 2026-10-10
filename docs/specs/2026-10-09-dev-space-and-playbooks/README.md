# Developer Space + Playbooks — ТЗ-пак

Статус: **ПОСТАВЛЕНО** — волны В1–В5 слиты в `main` (2026-10-10); исходно пак был DRAFT для ревью
(дата пака 2026-10-09; база `rox-one` @ `0c918497d`, ветка `fix/product-tour-native-green`).

## Назначение

Пак описывает две новые поверхности приложения ROX — **Developer Space** (пространство разработчика)
и **ROX Playbooks** (ноутбук-поверхность) — от целей и требований до плана волн и приёмки. Пак
самодостаточен для инженера: каждый документ опирается на решения D1–D14 и карту фактов о текущем коде
из `00-BRIEF.md`.

## Состав

| Файл | Автор | Одна строка |
|---|---|---|
| `00-BRIEF.md` | — | Внутренний источник истины: решения D1–D14, карта фактов о текущем коде, риски, открытые вопросы O1–O8. |
| `01-PRD.md` | writer-1 | Цели/нецели, персоны, входные точки, сценарии, проверяемые FR-xx, состояния, метрики. |
| `02-SPEC-foundations.md` | writer-2 | Платформа: гейтинг роли, IA, ингест, джобы, артефакты/хранение, эгресс, агентский доступ, флаги/настройки, i18n, безопасность. |
| `03-SPEC-features.md` | writer-3 | Шесть инструментов-адаптеров, блоки вопросов, туры+демо-режим, свой вопрос, Playbooks (знания/код), подкаст, голос. |
| `04-UI-SPEC.md` | writer-4 | Экраны (адаптация RC-01..RC-12 + новые), компоновка, состояния, токены/моушн/a11y, reduced-motion. |
| `05-PLAN.md` | writer-5 | Волны В1–В5: файлы, флаги, DoD, гейты, ownership, RX-план, риски. |
| `06-acceptance-cases.json` | writer-6 | Машиночитаемые кейсы (валидный JSON), покрытие всех областей. |
| `07-DECISIONS.md` | writer-7 | Журнал решений D1–D14 + производные: контекст, альтернативы, обоснования, последствия, статус «принято». |

## Порядок чтения

1. `00-BRIEF.md` — сначала целиком: это источник истины и карта фактов.
2. `01-PRD.md` — что и зачем строим; проверяемые требования FR-xx.
3. `02-SPEC-foundations.md` — платформенный слой, общий для обеих поверхностей.
4. `03-SPEC-features.md` — конкретные фичи поверх foundation.
5. `04-UI-SPEC.md` — экраны и визуальные требования.
6. `05-PLAN.md` — как разбито на волны В1–В5 и что нужно для DoD.
7. `06-acceptance-cases.json` — приёмка.
8. `07-DECISIONS.md` — справочно, по мере вопросов «почему так».

## Глоссарий

- **Developer Space** — верхнеуровневая поверхность приложения: пользователь вставляет ссылку на
  репозиторий, получает репо-воркспейс с артефактами, блоками вопросов, турами и чатом (D2).
- **Репо-воркспейс** — пространство одного клонированного репозитория (`projects/<slug>`) с шестью
  артефактами, блоками вопросов и турами (D3, D7).
- **Снапшот** — версионируемое состояние анализа репозитория (по аналогии со снапшотами
  code-intelligence: `sourceRevision`/`artifactDigest`); при новом снапшоте артефакты и блоки обновляются
  по кнопке (D7, D8).
- **Артефакт** — единица вывода инструмента анализа: JSON/MD/SVG в `projects/<slug>/dev-space/...` с
  provenance; человекочитаемые страницы публикуются в Notes/Pages (D7).
- **Блоки вопросов** — три предгенерированных набора по 10 вопросов каждый: обучение;
  фичи/улучшения; безопасность/зависимости/производительность (D8).
- **Демо-режим** — визуальный слой туров: тёмная радиальная виньетка, пульс целевого блока,
  прогресс-полоса «шаг N/M», пауза/выход; при `prefers-reduced-motion` — статика (D10).
- **Плейбуки** — ноутбук-поверхность ROX (референс SurfSense/NotebookLM) с режимами «знания» и
  «кодбук» (D12).
- **Кодбук** — режим Плейбуков: ноутбуки-пайплайны по коду (волна В5).
- **Пресет-вопросы** — заранее заданные вопросы по загруженным источникам в режиме «знания» (D12).
- **Адаптер** — обёртка над внешним инструментом анализа, приводящая его вывод к артефактам ROX; один
  инструмент — одна операция (D4).
- **Consent** — гранулярное per-repo согласие на эгресс: вызовы модельных коннектов, сеть для CVE (OSV)
  и обновлений инструментов; аналог гейта PREVIEW/BIND, молчаливого эгресса нет (D6).

## Связи

- `00-BRIEF.md` — **внутренний** источник истины пака: все документы обязаны быть с ним согласованы и
  не вводить решений, не выводимых из него.
- `07-DECISIONS.md` — журнал решений: фиксирует альтернативы и обоснования к D1–D14, производные решения
  и открытые вопросы O1–O11.
- Машиночитаемая приёмка (`06-acceptance-cases.json`) связана с FR-xx из PRD и DoD волн из PLAN.

## Статус реализации (2026-10-10)

Все волны В1–В5 поставлены и слиты в `main` (одна волна = один PR, D14):

| Волна | Содержание | PR |
|---|---|---|
| В1 | роль-шаг «Кто вы?», флаги, поверхность «Разработчикам», ингест репозиториев, каналы | [#1658](https://github.com/rox-one/rox-one/pull/1658) |
| В2 | шесть инструментов-адаптеров, пайплайн/артефакты, поверхности репо-воркспейса, session-tools | [#1705](https://github.com/rox-one/rox-one/pull/1705) |
| В3 | блоки вопросов, SBOM/CVE (OSV), динамические туры + демо-режим, «свой вопрос» | [#1737](https://github.com/rox-one/rox-one/pull/1737) |
| В4 | Playbooks «Знания»: источники, пресет-вопросы, подкаст (сценарий → TTS → ffmpeg → плеер/экспорт) | [#1738](https://github.com/rox-one/rox-one/pull/1738) |
| В5 | Playbooks «Кодбук»: ноутбуки-пайплайны по коду | [#1739](https://github.com/rox-one/rox-one/pull/1739) |
| fix | `playbooks:codebookJob` в `BROADCAST_EVENT_CHANNELS` + пере-запись бюджетов бандла | [#1741](https://github.com/rox-one/rox-one/pull/1741) |

Открытые вопросы O1–O11 закрыты 2026-10-10 (статусы и ссылки — `07-DECISIONS.md`): O1/O2/O6/O7/O8
подтверждены кодом и ревизией D4, O3 — ADR-0021, O4 — ADR-0022, O5 — v1.x, O9 — full history +
`MAX_REPO_BYTES` (2 ГиБ), O10 — капы журналов 128/200 + последовательный LLM-слой, O11 — бюджет
12 000 ключей с гейтом `lint:i18n:budget` в `validate:ci`.

В8 (v1.x-рычаг из P6/D3, 2026-10-10) — **auto-watch репозиториев**: флаг `devspace.autoWatch.v1`
(default OFF), явное пер-репо согласие (`watchEnabled`), таймер в процессе приложения (`.unref()`,
стоп на shutdown), только `git fetch` + опциональный `pull --ff-only` — без авто-регенерации
артефактов и без демонов (`packages/server-core/src/devspace/watch.ts`).

Карта кода (где что лежит):

- **Dev Space, серверное ядро** — `packages/server-core/src/devspace/` (`clone.ts`, `watch.ts`,
  `runner.ts`, `artifacts.ts`, `runs.ts`, `publish-port.ts`, `tool-runtime.ts`, `questions/`,
  `security/`, `stages/`, `adapters/`); RPC `packages/server-core/src/handlers/rpc/dev-space.ts`.
- **Модель данных** — `packages/shared/src/dev-space/` (`types.ts`, `index.ts`).
- **Агентские session-tools** — `packages/session-tools-core/src/handlers/dev-space-{read,search,propose}.ts`
  + `packages/session-tools-core/src/dev-space/{runtime,scope}.ts`.
- **Playbooks (подкаст + ноутбук-обвязка)** — `packages/server-core/src/playbooks/` (`jobs.ts`,
  `script.ts`, `tts.ts`, `assemble.ts`, `episodes.ts`, `codebook/`); контракты —
  `packages/shared/src/playbooks/codebook.ts`, job-канал — `packages/shared/src/voice/podcast-job.ts`.
- **Renderer Dev Space** — `apps/electron/src/renderer/pages/dev-space/` (`DevSpaceHomePage.tsx`,
  `DevSpaceRepoPage.tsx`, `components/`); настройки — `pages/settings/DeveloperSettingsPage.tsx`;
  онбординг — `components/onboarding/RoleStep.tsx`; nudge — `components/dev-space/DevSpaceNudgeBanner.tsx`.
- **Renderer Playbooks** — `apps/electron/src/renderer/pages/playbooks/` (`knowledge/`, `codebook/`,
  `podcast/`, `components/`).
- **Флаги/атомы** — `packages/core/src/platform/workbench/{flags,extra-screen-flags}.ts`,
  `apps/electron/src/renderer/atoms/{dev-space,playbooks}.ts`.
- **Реестр RX** — `registry/rx-registry.yaml` (блок «Developer Space + Playbooks»).

Ссылки:

- Решения: `../../architecture/adr/0020-dev-space-code-intel-tools-revision.md` (D4, O1/O2/O7),
  `0021-dev-space-analysis-job-engine.md` (O3), `0022-dev-space-clone-storage-paths.md` (O4).
- Аудит ревизии инструментов: `audits/d4-tools-revision-2026-10-09.md`.
- Отклонения/решения реализации (каналы сверх фриза, Tabs W1.1, шим узла, ipc-каталог и др.):
  `IMPLEMENTATION-NOTES.md`.

## Следующий шаг

Волны **В1–В5** поставлены; дальнейшая работа — сопровождение поверхностей (SRF-0052/0053 в статусе
`active`), подключение внешних инструментов как optional runtime (INT-0037…0043) и наблюдение за
рисками RSK-0001…0010. План волн — `05-PLAN.md`.

Требования к документам пака: русский язык; утверждения о существующем коде подкреплены точными путями
из `00-BRIEF.md`; новые сущности помечены «новое»/«расширение»; неизвестное — `TODO(open)` (O1–O11);
никаких выдуманных путей/флагов/каналов.