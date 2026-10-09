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
export interface TabItem {
  id: string
  label: string
  icon?: ReactNode            // глиф из словаря; размер — по токену роли
  badge?: ReactNode
  closable?: boolean
  disabled?: boolean
  title?: string              // tooltip / полная подпись
}

export interface TabsProps {
  items: readonly TabItem[]
  activeId: string | null
  variant?: 'surface' | 'segmented' | 'browser'  // профиль анатомии
  density?: 'compact' | 'full'
  overflow?: 'scroll' | 'menu'
  keyboard?: boolean          // roving tabindex + ARIA tabs; по умолчанию true
  ariaLabel?: string
  trailing?: ReactNode        // напр. меню чипов браузера внутри вкладок поверхности
  onSelect(id: string): void
  onClose?(id: string): void
}
```

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