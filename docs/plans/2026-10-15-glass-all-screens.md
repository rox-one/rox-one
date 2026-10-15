---
title: Glass-волна — Arc Glass на все экраны (2026-10-15)
status: in-progress
branch: feat/glass-all-screens
base: origin/main (de8c8c714)
date: 2026-10-15
---

# Glass-волна: Arc Glass на все экраны

## Контекст

- `arc-glass` — тема по умолчанию новых установок (`ROX_THEME_ID`, `packages/shared/src/config/theme.ts`),
  dark-only: радиальный teal-обои + «стеклянная» рамка + контент одной скруглённой картой
  (`packages/ui/src/styles/tokens/layers.css`, `apps/electron/resources/themes/arc-glass.json`).
- Материал: `--glass-*` производные токены (`packages/ui/src/styles/tokens/material.css`), примитив
  `GlassSurface` + `glass.css`, ленивый скин `arc-glass-skin.css` (пилюля режимов, поповеры/меню,
  композер, Rox Mini), tiers `html[data-glass=full|basic]` (`packages/ui/src/lib/glass-capability.ts`).
- Сегодня стекло покрывает **только chrome и несколько плавающих элементов**. Экраны (списки, карточки,
  таблицы, тулбары, оверлеи, инспекторы) остались классическими: плоские заливки `--elev-*`, обычные рамки.
- Задача владельца (2026-10-15): «переработать всё здесь в glass design красивый, чтобы все экраны
  смотрелись очень красиво». Волна — реализовать это тотально и проверить визуально.

## Цель

Каждый экран приложения выглядит как одна стеклянная система:

1. **Chrome** (рельс, табы, заголовки панелей, статус) — стекло над обоями (есть; полируется).
2. **Внутренние поверхности экранов** — панели/рельсы, тулбары, карточки/плитки, таблицы, строки,
   пустые состояния, редакторы, оверлеи (диалоги/шиты/тосты) — стеклянные: тёплый hairline-кант,
   specular-блик сверху, слоистая тень, hover-блеск; blur — только на статичных/плавающих слоях.
3. **Деградации** — `prefers-reduced-transparency`, `data-contrast="high"`, `html[data-glass="basic"]`,
   `data-render-profile="performance"` → сплошные заливки без blur; светлая схема не регрессирует.
4. **Гейты зелёные**: typecheck, stylelint, UI-token ratchet (0 роста), целевые тесты, визуальная матрица.

## Контракт стеклянных поверхностей (заморожен)

Разметка ставит атрибут `data-glass-slot="<slot>"` (при необходимости `data-glass-tone`) на корень поверхности.
CSS-рецепты живут ТОЛЬКО в `packages/ui/src/components/glass/**` (+ токены в `styles/tokens/material.css`) и
скоупятся `html[data-theme="arc-glass"]`.

| Слот | Где | Поведение |
|---|---|---|
| `panel` | рельсы/инспекторы внутри контента | тинт фоновой семьи + hairline по шву; blur статичный |
| `toolbar` | липкие заголовки/тулбары | blur + hairline снизу |
| `card` | карточки/плитки | тинт + верхний блик + hairline; без blur; hover-блеск |
| `table` | контейнеры таблиц | тинт + hairline; строки — внутренние hairline |
| `row` | интерактивные строки | прозрачно; hover/selected — блеск/акцент; без сдвига layout |
| `empty` | пустые состояния | мягкая стеклянная плита |
| `editor` | читающие/редактирующие поверхности | плотная заливка ≥80% + блик; без blur |
| `dialog` / `sheet` / `toast` | оверлеи | blur + elev-* тень; открытие — существующие motion-токены |
| `popover`, `composer`, `mini-button` (есть), `.rox-mode-pill` | — | не ломать существующие инварианты и тесты |

Правила:

- Только токены/`var()`; сырые значения — лишь в токен-файлах (`material.css`). Ratchet `lint:ui-tokens` — 0 роста.
- Blur статичен: никогда не анимируется/не транзишнится; motion — только `transform`/`opacity` (`--motion-*`).
- Читаемость AA сохраняется: заливки читающих поверхностей ≥70–85% (прецедент popover/composer).
- Никаких новых зависимостей, i18n-ключей и сдвигов layout; клавиатурная карта не меняется.
- Деградации обязательны: reduced-transparency/high-contrast → сплошной; performance-профиль → без blur.

## Слайсы и владение файлами

**Фундамент (критический путь):**

- **F1 glass-core** — `packages/ui/src/styles/tokens/material.css`, `packages/ui/src/components/glass/**`,
  `apps/electron/src/renderer/index.css` (glass-секции), playground-story `glass surfaces gallery`,
  тесты `glass.test.ts`.
- **F2 overlays-primitives** — `apps/electron/src/renderer/components/ui/{dialog,drawer,command,sonner,table,tabs,context-menu,dropdown-menu,scroll-area}.tsx`,
  `packages/ui/src/components/{overlay,primitives,ui}/**`, `packages/ui/src/components/tooltip.tsx`.

**Экраны (параллельно, после фундамента):**

- S1 чат (ChatDisplay*, TurnCard*, input/**, platform/{ChatContinuum,ComposerDeck,InlineApproval}*)
- S2 сессии/сайдбар (SessionList/Item/Lanes, LeftSidebar, NavigatorPanel, панели стека, память)
- S3 задачи (pages/tasks/**, pages/TasksPage.tsx)
- S4 заметки (pages/notes/**, pages/NotesPage.tsx, components/notes/**)
- S5 knowledge (pages/Knowledge*, components/knowledge/**, knowledge-map)
- S6 настройки (pages/settings/**, components/settings/**)
- S7 feed/inbox/team (pages/{FeedPage,InboxPage,TeamSurfacePage}, pages/{feed,inbox}/**, компоненты семейств)
- S8 календарь/встречи (pages/{CalendarSurfacePage,MeetingsPage}, pages/meetings/**, components/{calendar,meetings}/**)
- S9 прочее (drive, canvas, extra-screens, workspace-work, clipboard, search, shortcuts, project, playbooks, cookbooks, dev-space)
- S10 каталоги (connections, integrations, skills, sources)
- S11 поверхности (browser, terminal, extensions, cloud runs; components/{browser,cloud-runs}/**, packages/ui/src/components/terminal/**)
- S12 chrome/platform (ActivityRail, SurfaceTabs, PanelHeader, StatusBarHost, InspectorHost, Lens*, ModeBar, Omnibox*)
- S13 онбординг/mini/системное (components/onboarding/**, OnboardingHost, MiniSessionSurface, SplashScreen, voice overlay, palette)
- S14 webui (apps/webui/src/**)

## Приёмка (гейты волны)

1. `bun run typecheck:all`; 2. `bun run lint:css`; 3. `bun run lint:ui-tokens` (0 роста);
4. целевые `bun test` стеклянных/затронутых семейств; 5. `bun run test:visual` (+ перезапись базлайнов, если
снимки меняются осознанно); 6. `bun run electron:build:renderer` (стартовый бандл не растёт; boot-manifest и
bundle-size перезаписываются по прецеденту волн); 7. живая проверка: скриншоты Playground-историй и приложения.

## Риски и откат

- Только классы/токены/атрибуты: откат — revert коммитов волны; миграций нет.
- Прочие темы не затрагиваются (весь новый CSS скоупится `html[data-theme="arc-glass"]`).
- Перф: blur — только статичные/плавающие поверхности; больших анимированных blur-областей не появляется.

## Вне скоупа

- ios/viewer/CLI-поверхности. Изменение поведения в других темах. Новые зависимости. Правки логики (только визуальный слой).
