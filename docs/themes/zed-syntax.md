# Синтаксис Zed в ROX

Статические темы Shiki созданы из локальных установленных Zed JSON, зафиксированных в [zed-import.md](zed-import.md). Имена: `rox-nordfox-opaque`, `rox-min-dark-blurred`, `rox-siri-light`. На машине пользователя Zed и его настройки не меняются.

## Перенос категорий

Zed capture names сопоставлены TextMate scopes: `keyword` → `keyword/storage`, `function` → `entity.name.function/support.function`, `string` → `string`, `comment` → `comment`, `number` → `constant.numeric`, `type` → `entity.name.type/support.type`, `property` → `variable.other.property/meta.object-literal.key`, `variable.parameter` → `variable.parameter`. Полное соответствие зафиксировано в JSON: `settings[].name` содержит исходное имя capture, а `settings[].scope` — все сопоставленные TextMate scopes. Отдельные grammars Shiki могут не выдавать узкий scope, поэтому совпадение категорий не обещает идентичную токенизацию двух редакторов.

`font_style: italic/oblique` переводится в TextMate `italic`; `font_weight >= 600` — в `bold`; явно заданный normal/400 сбрасывает стиль пустой строкой. Код, язык, clipboard и diff содержимое не меняются.

## Минимальные коррекции читаемости

Проверка использует WCAG luminance ratio 4.5:1 относительно непрозрачного исходного `editor.background`. Если исходный цвет не проходит, он минимально смешивается с белым для тёмной темы или с чёрным для светлой; остальные цвета сохраняются. Для Min Dark размытие относится к оболочке, код остаётся на исходном непрозрачном `#1A1A1A`.

| Тема | Категория | Оригинал | Адаптация | Контраст до | Контраст после |
|---|---|---|---|---:|---:|
| Nordfox - opaque | `comment` | `#60728a` | `#909dad` | 2.540 | 4.527 |
| Nordfox - opaque | `comment.doc` | `#60728a` | `#909dad` | 2.540 | 4.527 |
| Nordfox - opaque | `emphasis` | `#bf616a` | `#cf888f` | 3.053 | 4.503 |
| Nordfox - opaque | `emphasis.strong` | `#bf616a` | `#cf888f` | 3.053 | 4.503 |
| Nordfox - opaque | `function.builtin` | `#bf616a` | `#cf888f` | 3.053 | 4.503 |
| Nordfox - opaque | `function.special` | `#bf616a` | `#cf888f` | 3.053 | 4.503 |
| Nordfox - opaque | `keyword` | `#b48ead` | `#b590af` | 4.409 | 4.504 |
| Nordfox - opaque | `number` | `#c9826b` | `#cd8c76` | 4.097 | 4.525 |
| Nordfox - opaque | `punctuation.embedded.markup` | `#b48ead` | `#b590af` | 4.409 | 4.504 |
| Nordfox - opaque | `punctuation.markup` | `#b48ead` | `#b590af` | 4.409 | 4.504 |
| Nordfox - opaque | `tag` | `#b48ead` | `#b590af` | 4.409 | 4.504 |
| Nordfox - opaque | `variable.special` | `#bf616a` | `#cf888f` | 3.053 | 4.503 |
| Siri Light | `attribute` | `#957931` | `#846b2c` | 3.672 | 4.507 |
| Siri Light | `comment` | `#9ea5b3` | `#6a6e78` | 2.188 | 4.514 |
| Siri Light | `comment.doc` | `#9ea5b3` | `#6a6e78` | 2.188 | 4.514 |

## Runtime

Все обычные codeToHtml потребители используют общий `resolveShikiTheme`. Pierre получает нормализованные custom themes под теми же именами, с регистрацией один раз. Для TipTap custom loaders добавляются в `bundledThemes` до создания его highlighter: его существующее расширение принимает только зарегистрированные строковые имена. Смена темы обновляет захваченный объект theme modes и принудительно пересчитывает decorations, не заменяя документ, selection или undo history.

## Терминал

Обычный `parseAnsi(input)` сохраняет старые фиксированные цвета. `parseAnsi(input, { themeAware: true })` использует CSS variables для ANSI normal/bright/dim: уже показанные spans перекрашиваются при смене темы. SGR 0, 22, 39 и 49 восстанавливают состояние; SGR 2 использует dim palette, SGR 1 — bright foreground. Extended truecolor/256-color сигналы обрабатываются атомарно без ошибочного трактования компонентов как новых SGR кодов. Отдельный PTY или xterm не добавляется.

## Проверка

`bun test packages/ui/src/components/code-viewer/__tests__/zed-shiki-themes.test.ts packages/ui/src/components/terminal/__tests__/ansi-theme.test.ts packages/ui/src/components/markdown/__tests__/tiptap-theme-state.test.ts`: 12 тестов прошли. Проверяются настоящие Shiki tokens/HTML, рендеринг diff через Pierre, string loaders TipTap, отсутствие изменения документа/selection при refresh, все 24 ANSI slots, resets, atomic extended colors, clipboard text и настоящий SSR TerminalOutput. UI и Electron typecheck прошли. Эти проверки подтверждают код и renderer contract; нативная визуальная приёмка приложения выполняется отдельно.
