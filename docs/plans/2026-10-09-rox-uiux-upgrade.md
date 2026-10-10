---
title: ROX UI/UX upgrade — волна 1 (G8+G9+G10), пилот G1, структурный трек G6→G3→G4
status: in-progress
branch: feat/intelligent-ui-20261009
date: 2026-10-09
---

# ROX UI/UX upgrade — план реализации

Источник предложений (заморожен, вне репозитория):
`~/Projects/2026-10-09-rox-uiux-proposals/` — `PROPOSALS.md` (10 предложений, сравнение,
рекомендация, «что не менять»), `AS-IS.md` (дефекты D-01…D-31 с замерами),
`report/g01…g10-*.md` (постатейные спеки с селекторами и значениями),
`prototypes/` (измеренные оверрайд-слои), `shots/` (до/после), `RECEIPT.json`.

## Решение пользователя (порядок работ, 2026-10-09)

1. Сначала — пакет **G8+G9+G10** (одна первопричина, строго улучшающие правки).
2. **G1** — пилотом как северная звезда (проба ≤30 мин определена в отчёте G1).
3. Далее структурно: **G6 → G3 → G4** (за флагами, по умолчанию выключены).
4. **G5** — со следующим вложением в чат (вне этой программы).
5. **G2** — только после перф-гейта (frame/GPU); гейт-проба выполняется в этой программе,
   реализация — только при прохождении.

## Волна 1 — пакет G8+G9+G10 (текущая)

| Поток | Область | Спека | Ключевые файлы |
|---|---|---|---|
| tokens | лестница материалов, фокус-система, состояния, motion, `--text-muted/--text-subtle` | g08 (23 токена), g09 P-09-31/35, g10 P-10-04/10 | `packages/ui/src/styles/**`, `apps/electron/src/renderer/index.css` |
| chrome | рельс/табы/заголовки панелей/статус/инспектор; материал из существующего состояния | g08 §Shell, g09 §A | `platform/RailRow.tsx`, `platform/ActivityRail.tsx`, `SurfaceTabs.tsx`, `PanelHeader.tsx`, `StatusBarHost.tsx`, `InspectorHost.tsx`, `App.tsx` |
| primitives | PremiumMenu, code block, terminal overlay | g09 P-09-16/28-30, g10 P-10-31 | `packages/ui/src/components/**` |
| chat+composer | карточка ошибки, пустое состояние, чипы композера | g09 §C/§D | `ChatDisplay.tsx`, `input/*` |
| lists | session list, entity-row, notes outline, мобильный компакт-список | g09 §B/§E, g10 22-27/34/37/38/40 | `SessionItem.tsx`, `entity-row.tsx`, `SessionList.tsx`, `pages/notes/*` |
| settings | навигатор/страницы/формы/скроллеры/legacy-пути | g10 1-16/25/28/35/38/39 | `pages/settings/*`, `components/settings/*` |
| onboarding | прогресс шагов, error, переходы | g10 17-21 | `components/onboarding/*` |
| browser+mobile | таб-стрип, тулбар, мобильный фрейм 390×844 | g10 29-34 | `components/browser/*`, `playground/demos/mobile-webui/*` |
| i18n | все новые/изменённые ключи, 12 файлов локалей | g09 P-09-06/26/34, g10 P-10-16/17/18/19/31/36 | `packages/shared/src/i18n/locales/*.json` |

Правила: только токены (без raw-значений), ru-first копирайт, blur — только chrome и никогда
не анимируется, `data-render-profile="performance"` не деградирует, клавиатурная карта не меняется,
новых зависимостей нет.

## Порядок и критерии приёмки

1. Волна 1: правки → i18n-проход → коммит `feat(ui): …` → `git merge origin/main`
   (rebase запрещён политикой репозитория) → гейты на слитом дереве → обновление визуальных
   базлайнов → скриншоты до/после (обе темы) → финальный коммит волны.
2. G1-пилот: отдельный эксперимент за флагом (по умолчанию выключен), story в playground,
   смоук-скриншоты; ≤30-мин проба из отчёта G1 фиксируется как вердикт.
3. G6 → G3 → G4: срезы за флагами (по умолчанию выключены), каждый со своей story и смоуком.
4. G2: гейт-проба (frame/GPU) с evidence; вердикт фиксируется в этом файле; реализация — только
   при «pass».

Гейты волны 1 (обязательные, зелёные на итоговом дереве):
- `bun run lint:ui-tokens` (ратчет: без новых нарушений);
- `bun run lint:css`;
- `bun run lint:i18n:parity && bun run lint:i18n:sorted && bun run lint:i18n:coverage`;
- `bun run typecheck:all` (минимум: electron, ui, shared);
- целевые `bun test` затронутых пакетов; `bun run test:visual` с обновлением базлайнов;
- `bun run electron:build:renderer` — стартовый бандл не растёт.

## Риски и откат

- Все правки волны 1 — классы/токены: откат = revert коммита; миграций и данных нет.
- Пилоты по умолчанию выключены: при выключенном флаге поведение идентично текущему.
- Визуальные базлайны меняются осознанно (контраст и высоты) и переснимаются один раз.

## Результаты по мере выполнения

### G2 перф-гейт — PASS (2026-10-09)

Проба выполнена на прототипе (`evidence/g02-gate.json` в proposals-workspace): p95 кадра при
скролле/печати **17.5 ms** (конвенционный порог ≤34 ms), дельта «поле включено − плоско» ≈ **0 ms**,
**0** постоянных анимаций; деградации (flat/HC/reduced) подтверждены computed-стилями. Ограничения
(честные): софт-GPU SwiftShader, не проверен resize-storm, нагрузка синтетическая — полный список в
`honest_limits` evidence-файла. **Решение:** поле (aurora) включается только за флагом (пилот,
дефолт OFF); command deck в пилот не входит.

### Волна 1 + пилоты — выполнено (2026-10-09)

- Пакет G8+G9+G10 — коммит `37da7801f` (91 файл, +1260/−313); сверка с `origin/main`
  (328 коммитов) — merge `c2fadec91`: 21 конфликт разрешён (локали — union по ключам,
  скрипт `tools/resolve-locale-conflicts.py`; шесть переписанных main UI-файлов — дельты
  накатаны на новые структуры; обе секции план-дока сохранены).
- Пилоты G1/G2/G3/G4/G6 — коммит `06bf30a07`: шесть флагов `craft-feature-*` (default OFF),
  каждая поверхность не рендерится без своего флага; +75 ключей i18n × 12 локалей.
- Визуальные базлайны — `458358997` (30 снимков), фикс aurora-стори — `ccf830525`.
- Гейты на слитом дереве: `lint:ui-tokens` без роста (8060 против 8227, 0 новых);
  `lint:css` 0 ошибок; i18n parity 10772 ключа × 12 + 311 тестов; electron/ui/shared
  тайпачеки 0 ошибок; курсированная renderer-сьюта 129/129; tokens-v2 33/33; визуальный
  матрикс — 30/30 зелёных (часть с retry).
- Скриншоты до/после (обе темы, 1440×960 + сплит 1000 + mobile 390×844):
  `shots/impl-*.png` (47 шт.) в workspace программы; «до» — корпус AS-IS на той же
  съёмке; «после» — итоговое дерево.
- Полная запись внедрения: `~/Projects/2026-10-09-rox-uiux-proposals/IMPLEMENTATION.md`.
- G5 (чат+композер) остаётся следующей волной; G2 прошёл перф-гейт и включён флагом.

### Волна 2 — G5 «Диалог» + отложенные слайсы G6/G4 — выполнено (2026-10-09)

Получено следующее вложение в чат → по порядку пользователя волна 2 = G5 «Диалог» (прототип уже
собран и прошёл пробу: `proto/g05-dialog`, `evidence/g05-probe.json` — оба вердикта зелёные) плюс
документированные отложенности волны 1 (панельный swap, дека раскладок, счётчики непрочитанного,
потребители чипа «Сохранено»).

| Поток | Флаг | Срез | Ключевые файлы |
|---|---|---|---|
| G5 континуум | `craft-feature-dialog-continuum-v1` | непрерывный транскрипт: жёлоб времени 72px, спина 1px, метка 3×12, проза 68ch, thinking-строка, границы сессий; compact-поповер Edit сохраняет легаси-карточки | `components/app-shell/chat-continuum/*`, `ChatDisplay.tsx`, `TurnCard.tsx` (минимально) |
| G5 артефакты | `craft-feature-dialog-artifacts-v1` | инлайн-артефакты (run/diff/screenshot) по реальным данным активностей и инлайн-одобрения permission/credential в ходу (композер свободен) | `chat-continuum/{ArtifactShell,DiffArtifact,RunArtifact,ScreenshotArtifact,InlineApprovalCard,InlineCredentialCard}.tsx` |
| G5 дека | `craft-feature-composer-deck-v1` | композер-дека: трей (32px цели), полоса диктовки, чипы h-7 с реальными селекторами | `components/app-shell/input/deck/*`, `FreeFormInput.tsx` |
| G6 wave 2 | `craft-feature-panel-swap-v1` | обмен панелей драгом (ghost + цель) и ⌥⌘S (`panel.swap`), порядок в `panelStackAtom` | `PanelStackContainer.tsx`, `PanelResizeSash.tsx`, `PanelSeam.tsx` |
| G4 дек | `craft-feature-layout-engine` (был) | дека раскладок ⌘\ (`layout.deck`): 4 пресета с живыми превью, disable невыполнимых с недостачей px, пилюля пресета в заголовке панели | `platform/LayoutDeck.tsx`, `ActivityRail.tsx`, `App.tsx`, `PanelHeader.tsx` |
| G6 счётчики | `craft-feature-session-lanes-v1` (был) | числовые счётчики непрочитанного на строках (по `loadedSessionsAtom`), легаси-точка для незагруженных | `SessionLanes.tsx` |
| P-10-15 | — | чип «Сохранено» во всех футерах настроек; словарь диктовки в голосовой странице | `pages/settings/*` |

Приёмка волны 2 (выполнено): тайпчеки electron/ui/shared — 0 ошибок; `lint:css` — 0 ошибок;
`lint:ui-tokens` — 0 новых (8060 базлайновых); i18n parity 10851 × 12, sorted/coverage — зелёные;
курсированная renderer-сьюта 1589/1592 (2 предсуществующих env-фейла `header-status-presence` —
react-dom/server в bun, не связаны с волной); экшены/шорткаты/лейны/панели/рендер-профиль — зелёные;
`tokens-v2` 37/37; визуальный матрикс — 7 story × 6 проектов (42 снимка, 12 новых базлайнов;
первые тесты холодного Vite требуют retry/прогрева — известное свойство площадки);
адверсарный аудит волны 1 — A/B/C/D PASS (паритет OFF, достижимость ON, i18n/a11y, токены/базлайны).
Попутно найдены и починены предсуществующие красные тесты: `tokens-v2` z-слои (material-layer `calc()`),
`radius-everywhere` (стейл-ожидание делителя 6 %), `browser-surface-v2` (литерал `{children}`),
`render-profile` (анкер OPAQUE OVERLAYS + OrbitBoard на общий `prefers-reduced-motion`),
w1-07 baseline-фикстура (3 новых экшена), UI-001 harness stub (`isClipboardHistoryNavigation`).
Гейт-заготовка: `panel.swap` (⌥⌘S) и `layout.deck` (⌘\) зарегистрированы как действия, при OFF-флаге
клавиши не перехватываются (handler `enabled`); «Миссии» получили достижимость (`missions.open` в ⌘K).
Все флаги волны 2 — default OFF; флаг OFF ⇒ байт-идентичное прежнее поведение.

### Волна 3 — G7 «Типографика и плотность 2.0» + завершение G4 «Студия» — выполнено (2026-10-10)

Состав — коммит `53c4c8db1` (426 файлов, +3607/−2666), слияние с main (+94 коммита) — `b37771358`:

- **G7 токен-слой**: px-боксы строк на рампе (11/16 · 12/16 · 13/20 · 15/24 · 18/24 · 24/32),
  новые шаги `data 13/18`, `prose 15/24`, `title-md 16/22`, `stat 20/28`, `hero 44/48`,
  `mark 9/12`, `--text-floor 11px`; трекинг-роли (`--tracking-caps/label`), `--numeric-features`
  с ролью `.numeric`, утилиты `.caps-label / .label-tracking / .prose-body / .prose-measure`,
  слой плотности `tokens/density.css`; `--text-code-size 12.5px`.
- **G7 свип**: ~1450 px-литералов в ~230 файлах приведены к рампе; `tabular-nums → .numeric`
  (0 пропусков), `tracking-wide/wider → .caps-label` на капс-ранах, `title=` на усечённом
  тексте (334), покрытые leading сняты.
- **G4 завершение** (за `craft-feature-layout-engine`, OFF ⇒ байт-идентично): магнитные швы
  25/50/75 % на **реальных** сёмах (сайдбар, навигатор, grid) с гайдом и бейджем размера,
  профили раскладок (additive `profiles[]`), геометрия в статус-баре, секция «Раскладка»
  в настройках (пресет по умолчанию + «помнить на пространство») и шаг онбординга; i18n +17 ×12.

Волна ревью — коммит `09c931d18` (4 адверсариальные линзы: токены, свип, G4-движок, контракты):

- `.numeric` был молчаливым no-op (`font-variant-numeric` не принимает feature-tag синтаксис) →
  `font-feature-settings: var(--numeric-features)` + `tabular-nums`: 177 сайтов вернули табличные цифры.
- Плотность: condensed-дефолты объявлены безусловно на `:root`, алиасы `compact`/`comfortable`
  совпадают со значениями приложения (атрибут живёт на контейнерах); неиспользуемые gap-токены удалены.
- Рампа: `--text-hero` вернул таймер Focus (был срезан 44→24px), `--text-mark` — единственное
  документированное под-флорное исключение для глифов в фиксированных плитках (инициалы, «+N»,
  плитки бейджей); пол — контракт с ассертом в `tokens-v2` (все px-шаги ≥ `--text-floor`).
- Регрессии свипа: 19 line-box'ов восстановлены (Learning/TaskEditor/Memory), `leading-tight`
  счётчика SessionItem, эмодзи-иконки на рампе, опечатка `caps-labelr`; реестры `ROX_TEXT_SIZES` /
  `ui-tokens.cjs` / `lucide-icon` дополнены.
- G4: снап подключён к производственным швам (`bounds.snap`), тоггл «помнить раскладку» управляет
  загрузкой, атом геометрии чистится на unmount.
- Контракты и устаревшие пины: глиф-концепты `clipboardHistory/drive/developers/playbooks`
  (+lucide-реестр), `menu-icons` (`FolderGit2/NotebookPen`), `expired → text-status-warning`,
  `control-sm` в BrowserTabStrip (merge-артефакт), пины composer/chrome-leftover/switch-contrast/
  mention-roundtrip/UI-001 lifecycle ×3 — обновлены с git-доказательствами (5890bb5fd, 095aad3fa,
  d75b1ba04, db056c501); снапшот entity-stories перегенерирован (112).

Гейты на финальном дереве: `typecheck:all` — 0 ошибок; i18n parity **11 502 × 11** + sorted/
coverage/budget ✓; `lint:ui-tokens` — **0 новых** (6479 заbaselined, на 6 меньше базы);
`lint:css` — 0 ошибок (730 warning-класса базлайна); `tokens-v2` **36/36**; фикс-кластер
**209/209** (9 сьютов по отдельности); визуальные базлайны пересняты — **5 экранов × 112
снапшотов (560)**, `run-unified-gates` 13 pass / 2 advisory-fail (config-paths — унаследовано,
plan.md:161; axe — input-label/button-name), артефакты `.visual-artifacts/`.

Полный serial-прогон (**2 660 сьютов**, bun 1.4.2): **2 579 passed / 81 failed = 22 новых +
59 known-red**; после слияния main (+73, дерево 2 670 сьютов) — **2 587 passed / 83 failed =
25 новых + 58 known-red** (состав тот же: main-класс + флейки, единственный не встречавшийся
ранее файл `startup-caller-boundary` тоже байт-в-байт с main). Все новые падения байт-в-байт
совпадают с `origin/main` (кроме `product-learning-results.browser.test.ts` — наша правка пути
chromium, и `tests/visual/playground.spec.ts` — 15-минутный whole-suite дедлайн); каждый
воспроизведён поодиночке. Это предсуществующее семейство, вскрытое скоупом полного прогона
(прошлый прогон видел 762 сьюта), а не волна-3. Починены нашим фиксом и проверены
зелёными: `openui-block` 11/11, `kernel-availability` 5/5, `panel-workspace` 9/9 (в тишине;
в полной нагрузке возможен флейк хука), `connections-lifecycle` 7/7, `radar-lifecycle` 1/1,
`boot-manifest` 7/7 (регенерация после G7/G4: 48 boot-chunk, 15 маршрутов), `switch-contrast`,
`glyphs`/`menu-icons`/`design-token-classes`. Остаточный дрейф (appearance 4–5
материал/клавиатура-ассертов, chat-scroll 2 скролл-тайминга под полной нагрузкой,
product-learning 1 IO-ассерт) — наблюдаемый после починки сборки, не связан с содержимым
волны-3. Main-класс (server/agent/e2e/lark + `configuration-guide` без `craft-cli.md` на main,
`check-config-paths` — унаследован по plan.md:161) оставлен как есть и передан владельцу;
checked-in `test-baseline.json` (130 записей) не трогали — по прецеденту репо наследованное
документируется, а не абсорбируется. Единственный реальный gap волны, закрытый приёмкой:
boot-manifest не был перегенерирован в коммите волны (`bun run scripts/boot-manifest.ts`).

Живая проверка G4 ON-пути (флаг через `localStorage craft-feature-layout-engine=true` в
zed-фикстуре): реальный драг шва → `data-snap="true"`, гайд, бейдж «530 px·snap 50 %», коммит в
снап-цель, 0 ошибок страницы; скриншот `~/Pictures/Shots/Agents/rox-g4-snap/on-path-*.png`.

Окруженческие грабли, найденные приёмкой: `~/.bun/bin/bun` (1.3.10) в PATH затеняет
репо-пинованный 1.4.2 — под ним playwright-фикстуры падают с «Target page … has been closed»;
playwright-chromium-1248 имел битую подпись бандла (переустановлен).