# План цикла «Согласованность рабочей среды»

Нормативная часть — `spec.md` (решения D1–D9). Здесь: волны, владельцы, зависимости, приёмка и правила интеграции.

## Правила работы в ветке

1. Все правки — только в worktree `/Users/t/rox-work/workbench-v2` (ветка `feat/workbench-consistency-20261009`).
2. Один владелец на файл. Пересечение владений запрещено; при необходимости — сообщение владельцу через `agent://<id>`.
3. Новые строки интерфейса: агент **не** правит 12 локалей; он пишет ключи и значения (ru/en) в `docs/specs/2026-10-09-workbench-consistency/i18n/<slice>.json`, интегратор вливает их скриптом. В коде — обычный `t('…')`.
4. Агенты не делают коммитов и не запускают репозиторные сьюиты (только целевые проверки своего среза). Коммиты и общие гейты — за интегратором.
5. Каждый срез возвращает: файлы, точные команды и наблюдённый результат, остаточные риски. Без доказательств срез не закрывается.

## Волны

### W0 — фундамент

| # | Работа | Владелец | Файлы (владеет) | Статус |
|---|---|---|---|---|
| W0.1 | worktree + ветка от `origin/main` | интегратор | — | ✅ `7c2c202b7` |
| W0.2 | Один примитив `Kbd` вместо трёх копий | `KbdDedup` | `components/ui/kbd.tsx`, `KeyboardShortcutsDialog.tsx`, `pages/ShortcutsPage.tsx`, `pages/settings/ShortcutsPage.tsx` | 🔄 |
| W0.3 | Ратчет канона иконок/размеров | `IconRatchet` | `eslint-rules/icon-size-tokens.cjs`, конфиги eslint, `scripts/lint-baseline.ts`, baseline, `entity-row.tsx`, `empty.tsx`, TopBar/NotesPage точечно | 🔄 |
| W0.4 | spec + plan | интегратор | `docs/specs/2026-10-09-workbench-consistency/**` | 🔄 |

### W1 — ядро обрамления (параллельно, непересекающиеся файлы)

| # | Работа | Владелец | Файлы (владеет) | Зависит от |
|---|---|---|---|---|
| W1.1 | Единая система вкладок: примитив + миграция сегментов представлений + ARIA/клавиатура + тесты | `TabsCore` | новый `components/ui/tabs.tsx`, `platform/SurfaceTabs.tsx`, `components/app-shell/EntityViewTabs.tsx`, CSS вкладок, тесты вкладок | W0.3 (только baseline) |
| W1.2 | Канбан: полная клавиатурная навигация по сетке | `KanbanKeys` | `components/app-shell/kanban/**` | — |
| W1.3 | «Пульт»: командная поверхность + капслок + ⌘K | `PalettePult` | новый `components/palette/**` (имя на выбор), `actions/definitions.ts` (точечно), `actions/registry.tsx` (точечно) | — |
| W1.4 | Пилюля v3: состав по частоте, пиннинг, токены, roving | `PillV3` | `platform/ModeBar.tsx`, `components/app-shell/titlebar-mode-pill.css`, новые атомы состава | — |

### W2 — потребители и экраны

| # | Работа | Владелец | Зависит от |
|---|---|---|---|
| W2.1 | Браузерные вкладки — на общий примитив; чипы браузера в меню вкладки поверхности (ADR-0001) | `BrowserTabs` | W1.1 |
| W2.2 | Сцены: сохранение/вызов раскладок, источник состава пилюли | `Scenes` | W1.4 |
| W2.3 | Экран «Активность» | `ActivityScreen` | W0 |
| W2.4 | Экран «Библиотека» (каталоги) | `LibraryScreen` | W0 |
| W2.5 | Экран «Состояние» | `HealthScreen` | W0 |
| W2.6 | Словарь глифов «сущность → значок» + миграция потребителей | `Glyphs` | W1.1 |

### W3 — слияния и перф

| # | Работа | Владелец | Зависит от |
|---|---|---|---|
| W3.1 | Лента ← Входящие + Уведомления | `FeedMerge` | W2.x |
| W3.2 | Календарь ← Встречи | `CalendarMerge` | W2.x |
| W3.3 | Команда ← Контакты | `TeamMerge` | W2.x |
| W3.4 | Виртуализация больших списков + бюджеты на реальных объёмах | `PerfVolume` | W1 |

### W4 — приёмка и отгрузка

Матрица macOS/Windows/Linux/WebUI, визуальные скриншоты, отчёт, PR. Ветку не удалять.

## Замороженный интерфейс вкладок (W1.1/W2.1)

```ts
export type TabsVariant = 'surface' | 'segmented' | 'browser'
export type TabsDensity = 'compact' | 'full'
export type TabsOrientation = 'horizontal' | 'vertical'
export type TabsTone = 'default' | 'accent'

export interface TabItem {
  id: string
  label: string
  /** Glyph from the entity dictionary. Size it with a token (`icon-caption`). */
  icon?: React.ReactNode
  badge?: React.ReactNode
  closable?: boolean
  disabled?: boolean
  /** Tooltip / full caption. */
  title?: string
  /** id of the controlled `role=tabpanel` element; rendered as `aria-controls`. */
  controls?: string
}

export interface TabsProps {
  items: readonly TabItem[]
  activeId: string | null
  /** Anatomy profile. Defaults to `surface`. */
  variant?: TabsVariant
  /** `compact` = control-sm height, `full` = control-md height. Defaults to `compact`. */
  density?: TabsDensity
  /** `scroll` keeps one scrollable row; `menu` reserves a trailing overflow slot. */
  overflow?: 'scroll' | 'menu'
  /** Arrow axis: horizontal uses Left/Right, vertical also accepts Up/Down. */
  orientation?: TabsOrientation
  /** Active-item tint. `default` = shell selection, `accent` = accent tint. */
  tone?: TabsTone
  /** Collapse labels under the panel container query (segmented view switch). */
  collapseLabels?: boolean
  /** roving tabindex + ARIA tabs; default true. */
  keyboard?: boolean
  ariaLabel?: string
  /** e.g. the browser-chips menu inside surface tabs. */
  trailing?: React.ReactNode
  className?: string
  /** Base text for the close button (`<closeLabel>: <title>`). */
  closeLabel?: string
  onSelect(id: string): void
  onClose?(id: string): void
}
```

Потребители опциональных полей: `SurfaceTabs` — `controls` (L168) и `closeLabel` (L187); `ModeScreen` — `tone="accent"` (L79/L324); `EntityViewTabs` — `collapseLabels` (L177) и `variant` (L175/L190).

Требования к поведению: `role=tablist/tab`, `aria-selected`, `aria-controls`, roving tabindex, ArrowLeft/Right (и Up/Down в вертикальных профилях), Home/End, Enter/Space, Delete/Backspace при `closable`, закрытие средней кнопкой, видимый фокус, автоматическая активация при перемещении фокуса.

## Приёмка волн (что считается доказательством)

| Область | Доказательство |
|---|---|
| Поведение | Целевой тест + ручной сценарий (клик/клавиши), вывод в отчёте |
| Вкладки/пилюля | Тесты клавиатуры (roving, Home/End, Delete, средняя кнопка) + ARIA-атрибуты в DOM |
| Визуальное | Скриншоты изменённых поверхностей до/после; отсутствие скачков размеров |
| Перф | Числа `test:perf-budgets` и прогон на больших объёмах (заметки/закладки/пароли/сессии) |
| Платформы | macOS локально; WebUI headless; Windows/Linux — имеющиеся CI-лейны или явная граница |
| Гейты | `bun run lint`, `typecheck` затронутых воркспейсов, целевые тесты, i18n-паритет |

## Состояние выполнения (2026-10-09)

| Волна | Срез | Статус | Доказательство |
|---|---|---|---|
| W0.2 | Один примитив `Kbd` | ✅ | три локальные копии удалены; 23 теста зелёные |
| W0.3 | Канон иконок/размеров | ✅ | `lint:ui-tokens` OK; clamp строк → 14, пустые состояния → `--icon-empty`, штрихи TopBar → токен, радиус без литерала; негативный контроль ратчета доказан (проба → красный, откат → зелёный) |
| W0.5 | Реконсиляция 12 решений | ✅ | таблица §4.7 в `spec.md`; пересечения веток подтверждены `git diff --name-only` |
| W1.1 | Единая система вкладок | ✅ | новый `components/ui/tabs.tsx` (заменил неиспользуемый radix-примитив); `SurfaceTabs`/`EntityViewTabs`/`ModeScreen` — адаптеры; ARIA+roving+Delete+средняя кнопка; 25 тестов |
| W1.2 | Канбан-клавиатура | ✅ | сетка стрелок/Home/End/Escape, границы и пустые колонки; 23 теста |
| W1.3 | Пульт + капслок | ✅ | капслок → то же действие `app.omnibox`; предикат 4 теста |
| W1.4 | Пилюля v3 | ✅ | состав из данных, частота без «прыжков», пиннинг/исключение, токены, roving; 72 теста |
| W2.1 | Браузерные вкладки | ✅ | на общем примитиве; бейдж → ведущий глиф; baseline-переименование учтено; тесты зелёные |
| W2.2 | Сцены | ✅ | store + приоритет сцены над частотой; ⌘1..7 учитывают активную сцену; 21 тест |
| W2.3–W2.5 | Активность / Библиотека / Состояние | ✅ | 13+20+17 тестов; подключены в реестр/рейл/настройки; i18n влит (9756 ключей, паритет) |
| W3.1 | Лента ← Входящие | ✅ | секции на общем `Tabs`; тело очереди вынесено в `pages/inbox/InboxQueue.tsx` без копирования; 3 теста |
| W3.2/W3.3 | Встречи → Календарь, Контакты → Команда | ✅ | alias-маршруты + `calendar.page`; пустые shell'ы удалены; приоритет entity-маршрутов исправлен (113 тестов роутов) |
| W3.4a | Токен-пасс `InboxQueue` | ✅ | 54 → 0 гейтованных нарушений |
| W3.4b | Виртуализация заметок и списка сессий | ✅ | окна + overscan, закрепление выбранной строки; после слияния 92bd273b2 — апстримные `components/ui/entity-list.tsx` (windowed) и `WindowedTreeList`, цикл-локальные модули/тесты удалены, апстримный `list-virtualization.test.ts` восстановлен (см. «Слияние 92bd273b2») |
| W3.4c | DOM-бюджеты на реальных объёмах | ✅ | 2000 сессий: **3167 → 70 мс** p95 (гейт 600), 5000 заметок: **62 мс** p95 (гейт 300); `bun run test:perf:dom` |
| W4 | Визуальная приёмка (реальное приложение) и PR | ✅ | PR [#1641](https://github.com/rox-one/rox-one/pull/1641); пост-мерж приёмка ниже |

### Известные границы (честно)

- Закладки и пароли: пользовательского списка в продукте нет — перф-покрытие ограничено сессиями и навигатором заметок.
- Бандл: отдельный бюджет (`--bundle`), в DOM-гейт не входит.
- `lint:electron` содержит 7 предсуществующих `react-hooks/rules-of-hooks` ошибок в чужих тестовых файлах (вне наших правок).
- Человекочитаемые форматтеры чисел: в репозитории больше трёх реализаций; объединение требует решения по контракту (не форсировано, зафиксировано).
- Виртуализация: заголовки групп больше не sticky (как в уже отгруженной таблице), Tab-обход в дереве заметок — по отрендеренным строкам.
- Визуальные дельты канона: итог в разделе «Приёмка (факты)» — тумблеры возвращены к видимому весу (1.623), глифы 32 и hover 5 % приняты числами.
- Капслок: системный перехват (вне окна) требует нативного модуля + TCC — вне объёма (документированная опция ОС).

## Приёмка (факты, 2026-10-09)

- **Реальное приложение** (собранный Electron, изолированный профиль, DOM-замеры): пилюля — 5 элементов «Лента · Команда · Агент · Заметки · Браузер», элемент 28×24, глиф 16×16, штрих 1.75, радиус 6; капслок открывает Пульт (фокус в поле «Поиск или переход…»); клик по «Заметки» → `route=notes`; секции Ленты «Поток/Входящие» с ARIA и roving-обходом.
- **Живые проверки в приложении** (HEAD `ddb0b3e3b`, пересобранный dist): Escape закрывает «Пульт» за <200 мс (в т.ч. повторно и кликом мимо; прежний «отрицательный» результат оказался артефактом драйвера — мешал модальный онбординг памяти); «Разделы приложения» содержат Активность, Библиотеку и Состояние, и каждая открывается (заголовок и строки данных на месте); пилюля одинакова на Ленте/Команде/Агенте/Заметках (5 элементов, 28×24, глиф 16, штрих 1.75, радиус 6, `aria-current=page`); секции Ленты и «Виды» (Чат/Карта/Оглавление) — ARIA и клавиатура (ArrowLeft/Right, Home/End, roving tabindex); меню раскладки: «Развернуть» → `data-panel-layout="screen"` (панель 1372 из 1400 px), Escape → `auto`.
- **WebUI** (Chromium headless): `.rox-mode-pill` с теми же пятью поверхностями, рейл и роли (`navigation`, `tablist`, `tab`, `switch`, `listbox`, `status`, `combobox`) рендерятся, pageerror 0. Границы: обязателен `CRAFT_SERVER_TOKEN`, пустому конфигу нужен засеянный workspace.
- **Платформенная матрица**: macOS — локальные замеры + CI (`ci.yml` macos-15 ✓, `product-tour-native` macos-15 ✓); Linux — `ci.yml` ubuntu-24.04 ✓; Windows — `product-tour-native` windows-2025 ✓; WebUI — локальный headless-прогон.
- **CI ветки**: `CI Validate Alias` run 37884552997 ✓ (ubuntu-24.04 + macos-15), `product-tour-native` run 37884578361 ✓ (macos-15 + windows-2025), `Validate Server (Integration)` ✓ на пушах.
- **Канон, числами**: тумблеры «Входящих» после миграции потеряли контраст трека (1.62 → 1.10 против фона очереди) — исправлено возвратом `bg-foreground/20` с обоснованной директивой ратчета; в пересобранном приложении подтверждено **1.623** (кружок 6.93 к треку, 11.24 к фону). Глифы пустых состояний 28 → 32 приняты. Hover заголовков групп 2 % → 5 % (`bg-surface-hover`; 1.047 → 1.111) принят.
- **Предсуществующие красные (не наши)**: `switch-contrast.test.ts` и `provider.browser.test.ts` (30-секундные таймауты; красные и на чистом `origin/main`), 7 `react-hooks/rules-of-hooks` в `lint:electron`.
- **Вне фолда вкладок**: полоса `runtime-tabs` («Представление карты выполнения», `components/runtime-map/RuntimeToolbar.tsx`) — пятая tab-полоса, найденная проверкой в живом приложении; в примитив не переведена (кандидат следующего цикла, вместе с чипами OS-окон браузера по ADR-0001, которые продукт сознательно убрал из SurfaceTabs в #169).
### Пост-мерж приёмка (2026-10-10, ветка `feat/workbench-consistency-20261009`)

Ветка слита с `origin/main` дважды (последнее — `a2dea292b`: Electron 44, openclaw-порт, перезапись банджет-бейзлайна). Красные CI разобраны до конца, все — доказанно наши либо унаследованные:

| Что падало | Проверка авторства | Решение |
|---|---|---|
| `component-recovery` и `route-fixtures`: 60 ошибок esbuild (katex-шрифты) | тот же файл на чистом `origin/main` — 20/20 зелёный | цепочку дал метафайл esbuild: `SurfaceHost → TeamSurfacePage → TeamSessionButton → PanelHeaderCenterButton → @rox/ui` (широкий индекс статически тянет `chat → markdown → katex`); граница фикстуры расширена, как для `source-status-indicator` |
| Юнит-тест целостности ратчета | наш файл бейзлайна (2 удалённые записи) | точечный `--update --targets components/browser --prefix-merge`, 3 тотала пересчитаны |
| `Renderer bundle-size budget`: 14 бюджетов | сравнение сборок с чистым main (main зелёный) | перезапись документированным путём; дельты разобраны по чанкам (см. коммит `perf(bundle)…`) |
| `UI token lint ratchet` (шаг base-baseline) | все 6 файлов байт-в-байт `origin/main`; на чистом main тот же провал | передано владельцу: `--allow-increase` + метка `ui-baseline-override` |
| `unified-gates` (гейт `config-paths`) | на чистом main гейт падает на `docs/openclaw-port/STATUS.md:160` | унаследовано, наш вклад отсутствует (169 файлов проверены) |

Локальная приёмка после слияния: `validate:ci` ✓, `typecheck` ✓, `test:runtime-suites` `exit=0` ✓, `component-recovery`-шаг 1180/0, `route-fixtures`-шаг 1211/0, юнит-тесты бейзлайна 41/0, юнит-тесты бюджета 20/0, четыре сьюта вкладок 27/0. Сплошной прогон 634 не-браузерных файлов: 165 падений против 162 на чистом main (собирательный прогон смешивает jsdom/node-сьюты); все расхождения проверены изолированно — либо проходят, либо падают и на main.

CI PR: `component-recovery`, `route-fixtures (ubuntu)`, `Renderer bundle-size budget`, `browser-and-domain`, `durable-runtime (ubuntu)`, `validate (ubuntu)`, CodeQL, миграции — зелёные; открытыми остаются только унаследованные (`UI token lint ratchet`, `unified-gates`) и `Vercel` («Account is blocked»).

### Слияние 92bd273b2 (10.10) — реконсиляция с апстримом

- `pages/notes/NotesNavigationSidebar.tsx` и `components/ui/entity-list.tsx` — снова апстримные реализации (`WindowedTreeList` / окнированный `EntityList`).
- Цикл-локальные `pages/notes/notes-navigation-virtualization.ts` и `components/app-shell/entity-list-virtualization.ts` вместе с их тестами удалены.
- Единственная сохранённая добавка цикла в `entity-list.tsx` — проп `ensureVisibleKeys` (`components/ui/entity-list.tsx:139`), мульти-маунт строк поверх апстримного `withMountedAnchor` (`entity-list.tsx:526-527`).
- Потребитель этой добавки — `components/app-shell/SessionList.tsx` (`ensureVisibleKeys` L1077/L1467), передающий теперь апстримные пропы `windowed` (L1463) / `windowRowHeight` (L1464) / `windowOverscan` (L1465) / `scrollToKey` (L1466).
- Апстримный тест `components/app-shell/session-list/__tests__/list-virtualization.test.ts` восстановлен.
- DOM-харнесс меряет апстримный окнированный путь: `perf/dom-scenario.tsx` передаёт `windowed` (L126) и `viewportRef` навигатору заметок (L162), `perf-dom.tsx` даёт ему `#perf-notes` как `viewportRef` (L76).
