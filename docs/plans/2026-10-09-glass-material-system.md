# План: «Материал и эффекты» (Glass) — реализация

Спека: `docs/themes/glass-material-system.md`. Ветка `feat/glass-appearance-20261009` (от `main` 7c2c202b7). DoD: настраиваемый слой материала (blur/прозрачность/тинт/текстуры/haze/матовость/чат-эффекты) с пресетами и экспортом/импортом, живёт на странице Appearance; light+dark; все инварианты (blur не анимируется, a11y-фолбэки, токен-ratchet, i18n×12) соблюдены; тесты/сборки зелёные; визуальные доказательства обеих тем; PR в `rox-one/rox-one`.

## Фазы (зависимости по порядку; ≠ сериализация работ внутри фазы)

### Ф0. Prep (0.5ч)
- `bun install` в worktree; baseline-прогоны: `bun run typecheck:all`, профильные appearance/rPC тесты, `lint:css`. Зафиксировать исходно-красные (полный shared typecheck имеет известный baseline-долг — не считать регрессией).
- Verify: лог baseline сохранён в `~/Projects/rox-theme-20261009/evidence/`.

### Ф1. Схема + типы (core)
- `packages/shared/src/config/theme.ts`: `MaterialSettings` + merge; `themeToCSS` → эмит `--material-*`; `ThemeOverrides.material`.
- `validators.ts`: `MaterialSchema` (strict, клампы) в `ThemeOverrideSchema` и `PresetThemeSchema`.
- Тесты: `packages/shared/src/config/__tests__/theme-material.test.ts` (валид/инвалид/клампы/unknown/merge/round-trip).
- Verify: `bun test packages/shared/src/config` зелёный.

### Ф2. Токены + CSS-слой
- `packages/ui/src/styles/tokens/material.css` (дефолтные значения; raw только здесь) + агрегация в `tokens/index.css`; потребители: `packages/ui/src/styles/index.css` (chrome), `apps/electron/src/renderer/index.css` (shell/панели/чат/composer).
- Учесть `scripts/generate-chrome-tokens.ts` (не ломать генерацию).
- Verify: `lint:css`, `lint:ui-tokens` (baseline не вырос), renderer build.

### Ф3. Runtime (ThemeContext + native)
- `ThemeContext.tsx`: резолвер, data-атрибуты, инъекция vars, persistence в `theme.json` (override), live-обновление, взаимодействие с `data-render-profile`/a11y.
- `shell-appearance.ts`/`shell-material.ts`/`window-manager.ts`: tint-opacity (macOS), без изменений политики фолбэков.
- Verify: unit-тесты ThemeContext-хелперов; ручной прогон `webui:dev` (5175) со скриншотом; `electron:dev` — визуальная проверка вибранси.

### Ф4. UI Appearance + i18n
- Секция «Материал и эффекты» в `AppearanceSettingsPage.tsx` (+ CSS-контейнер узкой ширины), пресеты, экспорт/импорт, сброс; ключи во все 12 локалей (`t()`).
- Verify: компонентные тесты; `lint:i18n:parity|sorted|coverage`; скриншоты секции (1440/375).

### Ф5. Текстуры и чат-эффекты
- CSS-текстуры (grain/scanlines/pinstripe/herringbone) + worker (dither/ascii/halftone/scanlines) + градиент; кэш; перф-гард.
- Verify: unit-воркер (детерминизм), профайл покоя (эффекты статичны), визуальные скриншоты, фолбэк при ошибке.

### Ф6. Полировка light/dark по аудиту
- Аудит реальных экранов (Chat/Sessions, Settings/Appearance → Home/Notes) в обеих темах; фиксы поверхностей/типографики/пилюль/статусов по C-семейству референсов; без изменения IA.
- Verify: до/после скриншоты, регресс-прогон существующих visual-тестов (обновление базлайнов — только осознанно).

### Ф7. Приёмка и PR
- Полный прогон: `typecheck:all`, профильные `bun test`, builds (renderer/webui), acceptance-матрица со скриншотами (`~/Pictures/Shots/Agents/<session>/`), reduce-transparency/high-contrast фолбэки, второй таб/reload.
- PR в `rox-one/rox-one` со скриншотами и списком проверок; в описании учесть пересечения с #1625/#1620/#1618.

## Исполнители
- Lead (я): интеграция, Ф3, Ф6, приёмка, PR.
- Сабагенты: Ф1+Ф2 (один слайс: схема/токены), Ф5 (worker+текстуры), Ф4 (UI-секция) — независимые слайсы после Ф1-2; ревью — отдельный сабагент на диффы.

## Риски/стоп-правила
- Не анимировать blur; не дублировать blur в Electron (нативный материал); не трогать `DEFAULT_THEME` палитру (только добавить `material`-пресеты отдельными bundled-темами).
- При конфликте с PR #1625 (surface chrome) — разрешать в пользу их структуры, добавляя material поверх.