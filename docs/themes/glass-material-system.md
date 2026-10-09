# Материал и эффекты (Glass) — система кастомизируемого стекла

- Статус: draft для реализации. Раунд 1 grilling закрыт (Q1=B слой настроек + пресеты + экспорт/импорт; Q2=B + C опционально по поверхностям; Q3=полный набор ручек; Q4=macOS-first; Q5=бренд-ядро + приёмы референсов; Q6=go). Раунд 2 (Q7–Q12) — дефолты в §9.
- Дата: 2026-10-09. Ветка: `feat/glass-appearance-20261009` (от `main` `7c2c202b7`). Worktree: `~/Projects/archive/rox-one-glass-wt`.
- Источники: разбор `github.com/hardbeat920/monocode` (MIT; техники стекла), 15 референс-скриншотов (см. `~/Projects/rox-theme-20261009/vision/DIGEST.md`), существующая архитектура тем rox-one (`docs/themes/zed-import.md`, `docs/design/golden-gate/DESIGN-TOKENS.md`).

## 1. Цель

Слой «Материал и эффекты» поверх существующей системы тем. Пользователь настраивает: **blur, прозрачность по зонам, тинт, текстуры/шум, матовость, градиент-haze** и **эффекты чат-фона** (dither/ascii/halftone/scanlines), плюс готовые пресеты, live preview и экспорт/импорт JSON. Встраивается в существующую страницу Appearance, schema тем, ThemeContext и a11y/perf-фолбэки.

Не-цели v1: динамический тинт из обоев (отложено, Q8); верификация Windows Mica (поддержка архитектурно, проверка отложена); анимация blur (инвариант остаётся: blur никогда не анимируется); отдельный материал для вспомогательных окон (quick composer и т.п.).

## 2. Существующая база (что переиспользуем)

- Нативный материал: `apps/electron/src/main/shell-material.ts` (macOS `vibrancy 'under-window'`, Windows Mica ≥22621), `window-manager.ts`; pure-resolver `apps/electron/src/shared/shell-appearance.ts` (preference `system|glass|opaque`, причины фолбэка: reduce-transparency, high-contrast, low-power, gpu-failure, no-healthy-paint…).
- CSS-стекло оболочки: `apps/electron/src/renderer/index.css:962-1012` — `--shell-glass-blur: 20px`, тинты `color-mix(... 84%|82%|88% ...)`; `backdrop-filter` только для web-рантайма (в Electron композитит нативный материал, PERF-07/B14). `--chrome-glass-blur: 14px` в `packages/ui/src/styles/index.css:179-185`.
- Токены: `packages/ui/src/styles/tokens/*.css` (единственное разрешённое место raw-значений; `tokens/chrome.css` — источник `chrome-tokens.ts`, генерация `scripts/generate-chrome-tokens.ts`).
- Тема: `packages/shared/src/config/theme.ts` (`ThemeOverrides`, `mergeThemeOverrides`, `themeToCSS`, `DEFAULT_THEME`), `validators.ts:1608-1700` (`ThemeOverrideSchema`, `PresetThemeSchema`, strict), `storage.ts` (`theme.json`, `themes/*.json`, `ensurePresetThemes`, `loadPresetThemes`), watcher `watcher.ts:395-405`.
- Runtime: `apps/electron/src/renderer/context/ThemeContext.tsx` — загрузка пресета, `resolveTheme`, инъекция `<style id="craft-theme-overrides">` через `themeToCSS`, data-атрибуты `html` (`data-theme`, `data-scenic`, `data-blurred`, `data-contrast`, `data-shell-material`, `data-shell-runtime`, `data-render-profile`), persistence `config.json#colorTheme` + `craft-theme` localStorage, broadcast-каналы.
- UI: `apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx` (секции «Default Theme» / «Workspace Themes» + встроенные ZenShellSettings и др.), реестр `settings-registry.ts`.
- Инварианты (сохраняем): blur не анимируется; `reduce-transparency`/`prefers-contrast: more`/`data-contrast=high`/`data-render-profile=performance` → solid без blur; токен-ratchet (`eslint-baselines/ui-tokens.json`, stylelint `rox-css/*` — raw values только в token-файлах); i18n: все строки через `t()`, ключи во все 12 локалей (ru — дефолт).

## 3. Модель данных

Новое необязательное поле `material` в `ThemeOverrides` и `PresetTheme` (+ строгая zod-схема с клампами; отсутствие поля = текущее поведение):

```ts
type MaterialSurface =
  | 'topbar' | 'rail' | 'strip' | 'inspector'   // chrome-зоны
  | 'sidebar' | 'navigator'                      // левые панели
  | 'chat' | 'composer' | 'popover'              // чат-фон, composer, поповеры
type ContentPane = 'content' | 'editor' | 'lists' // Q2C «глубокое стекло» (opt-in)
type TextureKind = 'none' | 'grain' | 'scanlines' | 'pinstripe' | 'herringbone'
type ChatEffectKind = 'none' | 'gradient' | 'dither' | 'ascii' | 'halftone' | 'scanlines'

interface MaterialSettings {
  enabled?: boolean                        // мастер-выключатель слоя
  nativeTint?: 'theme' | 'custom' | 'off'  // источник нативного тинта macOS/Windows
  tintColor?: CSSColor                     // для nativeTint='custom'
  blur?: Partial<Record<MaterialSurface, number>>     // 0..64 px
  opacity?: Partial<Record<MaterialSurface, number>>  // 0..1 (доля непрозрачности)
  tint?: { hue?: number; saturation?: number; lightness?: number } // -180..180, -100..100, -30..30
  texture?: { kind?: TextureKind; intensity?: number; scale?: number }  // 0..1, 0.5..3
  haze?: { enabled?: boolean; intensity?: number }    // 0..1
  matte?: number                           // 0..1: 1 = полностью матовая подложка (solid-фолбэк вида)
  deepGlass?: Partial<Record<ContentPane, boolean>>   // Q2C, по умолчанию выключено
  chatEffect?: { kind?: ChatEffectKind; intensity?: number } // 0..1
}
```

- Дефолты при `enabled=true`: `blur {chrome:20, sidebar:20, navigator:20, popover:24, chat:12, composer:14}`, `opacity {topbar:0.84, rail:0.82, strip:0.88, inspector:0.88, sidebar:0.86, navigator:0.86, popover:0.92, chat:0.55, composer:0.7}`, `texture {kind:'none'}`, `matte:0`, `deepGlass` пусто.
- `mergeThemeOverrides` — глубокая merge для `material` (по под-объектам; скалярные поля override побеждают).
- Совместимость: темы без `material` не меняются; `mode:'blurred'` остаётся легаси-путём и мапится на дефолтный material-профиль.

## 4. Runtime-поток

1. `ThemeContext`: resolve пресета + override → `material = resolveMaterial(...)` (чистый резолвер: капнуть по платформе, render-profile, a11y) → 
2. инъекция в тот же `<style id="craft-theme-overrides">`: переменные `--material-*` (например `--material-blur-rail`, `--material-opacity-topbar`, `--material-texture-image`, `--material-haze-opacity`, `--material-chat-effect-image`);
3. data-атрибуты `html`: `data-material="on|off"`, `data-material-texture="grain|…"`, `data-material-deep="chat,lists"`, `data-material-chat-effect="…"`;
4. native sync: существующий `SET_ZEN_SHELL`-канал расширяется полем `tintOpacity` (для macOS tint = f(opacity.window)); при `nativeTint='off'` — solid;
5. CSS-потребители: `packages/ui/src/styles/tokens/material.css` (константы-дефолты), `renderer/index.css` (оболочка/панели/чат), `packages/ui/src/styles/index.css` (chrome-зоны, `.chrome-surface`). Композиция: `color-mix(in srgb, <surface> var(--material-opacity-x, 84%), transparent)`; blur — `backdrop-filter: blur(var(--material-blur-x, 20px)) saturate(1.15)` только там, где уже разрешено (web; native — без CSS-blur).
6. Персистентность: пользовательские значения сохраняются в `theme.json` (`material`-поле, переживает смену пресета как override) + экспорт/импорт полного JSON палитры+материала (`PresetThemeSchema`).

## 5. UI (Appearance → «Материал и эффекты»)

Секция на `AppearanceSettingsPage` (RU-строки, все 12 локалей):
- Тумблер «Материал» (`enabled`); материал окна — существующий Zen select остаётся;
- Пресеты-чипы: **Стекло** (дефолт), **Глубокое стекло** (deepGlass chat+lists), **Матовое** (matte=1), сброс;
- Группа «Прозрачность»: слайдеры по зонам (chrome/панели/чат/popover/composer) 0–100%;
- Группа «Размытие»: слайдеры 0–64 px по тем же группам;
- Группа «Тинт»: hue/saturation/lightness;
- Группа «Текстуры»: селект (нет/зерно/сканлайны/пинстрип/ёлочка) + интенсивность/масштаб;
- «Haze»: вкл + интенсивность; «Матовость»: 0–100%;
- «Эффекты чат-фона»: селект (нет/градиент/dither/ascii/halftone/scanlines) + интенсивность;
- Advanced: per-pane «глубокое стекло» (content/editor/lists);
- Экспорт/Импорт JSON, «Сбросить материал»; живое превью = сама страница + мини-карточка.

## 6. Текстуры и эффекты

Реализация независимая (техники — по MIT-каталогу MonoCode, без копирования кода):
- CSS-текстуры: grain (SVG feTurbulence, статичный), scanlines (`repeating-linear-gradient` 1px/3px), pinstripe (45°, поверхность как в #6), herringbone (тёмная тема #15);
- Worker `material-effects.worker.ts` (OffscreenCanvas → PNG dataURL ≤2048px, детерминированный seed): dither (Bayer 4×4), ascii (глиф-битmap 6×8), halftone (точки 4×4), scanlines (каждая 3-я строка);
- Кэш по ключу `kind+intensity+scale+palette`, инвалидация при смене темы; при `data-render-profile=performance` — эффекты не генерируются; статичные слои (никакой анимации на покое).

## 7. Деградация и ошибки

- `reduce-transparency` / high-contrast / forced-colors / performance-profile / GPU-failure / no-healthy-paint → solid (существующий resolver; настройки не теряются);
- web без backdrop-filter → solid matte через `@supports not`;
- ошибка воркера → чат-фон падает до градиента/none, UI не блокируется, ошибка логируется один раз;
- повреждённый JSON при импорте → zod-отказ с человекочитаемой ошибкой, текущая тема не меняется.

## 8. Тесты и приёмка

- unit: схемы (валид/инвалид/клампы/unknown-ключи), deep-merge, резолвер (платформа×a11y×profile — таблица), worker (детерминизм и размер), persistence merge, экспорт/импорт round-trip;
- integration: существующие appearance-тесты (RPC, workspace priority) + material round-trip через IPC; i18n parity/sorted/coverage;
- visual (обе темы × material on/off × маршруты Home/Sessions/Notes/Tasks/Inbox/Meetings/Settings/Appearance; 1440/375 @100/125/150%; hover/focus/motion): скриншоты + hit-tests по образцу `scripts/test/zed-appearance-web-acceptance.ts`; отдельно: reduce-transparency/high-contrast фолбэки, стабильность при reload и live-обновлении второго таба, отсутствие idle-CPU от эффектов;
- gates: `typecheck:all`, профильные `bun test`, `lint:css`, `lint:ui-tokens` (baseline не растёт), `lint:i18n:*`.

## 9. Открытые решения (Q7–Q12) и дефолты

| # | Вопрос | Дефолт до ответа |
|---|---|---|
| Q7 | дефолт после установки | текущий вид; «Стекло» — пресет с подсказкой |
| Q8 | тинт от обоев | фиксированный per-theme тинт (динамика — follow-up) |
| Q9 | текстуры в v1 | все (grain/scanlines/pinstripe/herringbone) + чат-эффекты |
| Q10 | accent-пресеты | да: бренд + `#FF4A1F`/`#F97316`/`#e8743e` |
| Q11 | приоритет полировки | Chat/Sessions + Settings/Appearance → Home/Notes |
| Q12 | судьба ~1 ТБ проектов | ожидает аудита `~/Projects/CTN-orchestration-20261003`, `2026-10-03` |

## 10. Риски

- производительность blur на больших окнах (ограничить blur-слои, guard-профиль);
- контраст текста поверх обоев (scrim/matte-подложки для читающих поверхностей);
- пересечения с открытыми PR (#1625 chrome, #1620/#1618 perf backdrop policy) — учитывать при rebase;
- расхождение screenshot-базлайнов Playwright при смене дефолтов визуала — обновлять осознанно, вместе с ревью.