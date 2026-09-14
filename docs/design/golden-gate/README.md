# Golden Gate — индекс требований, реализации и проверки

Родитель: [#541](https://github.com/rox-one/rox-one/issues/541). База: `22c8b89858f8c41d3f687f13d49a31b55045c146`. Дата: 2026-09-14.

Ветка содержит реальную работу над оболочкой, геометрией панелей, навигацией, общими примитивами, диагностикой и статусами. **Полный визуальный аудит и приёмка всех экранов не завершены:** browser policy блокирует локальный продуктовый URL, Electron/macOS проверки не выполнены. Все 25 опубликованных задач остаются открытыми до своих критериев приёмки.

| Документ | Что находится внутри |
|---|---|
| [SPEC.md](SPEC.md) | Краткие согласованные решения и границы реализации. |
| [PRD.md](PRD.md) | 17 проверяемых требований, поведение панелей/статусов/диагностики/текста и 8 предложенных экспериментов с метриками. |
| [SCREEN-MATRIX.md](SCREEN-MATRIX.md) | 7 оболочечных, 27 рабочих и 8 временных/вспомогательных групп, settings overview и все 22 settings страницы; реальные paths, controls/properties, E/L/X/P/K/R и baseline gaps. |
| [COMPONENT-INVENTORY.md](COMPONENT-INVENTORY.md) | Читаемый список 575 исходных TSX-файлов по семействам. |
| [INVENTORY.json](INVENTORY.json) | TypeScript AST index: 501 объявление Props, используемые JSX attributes, 45 route builders, 19 navigator families, 22 settings mappings. Runtime-достижимость не выводится из имени компонента. |
| [DESIGN-TOKENS.md](DESIGN-TOKENS.md) | Спецификация и изменения визуальных токенов, подготовленные направлением design system. |
| [NATIVE-SURFACES.md](NATIVE-SURFACES.md) | Видимость, состояние и ограничения встроенных native Browser/SiYuan/Extension панелей. |
| [QA-MATRIX.md](QA-MATRIX.md) | 45 сценариев, воспроизводимые данные, performance budgets, уровни доказательств и фактическая блокировка visual/native приёмки. |
| [VERIFICATION.md](VERIFICATION.md) | Итоговые команды, результаты, сравнение с базой и незавершённые проверки. |
| [ISSUE-LINKS.md](ISSUE-LINKS.md) | Точные ссылки GG-001…025 → опубликованные GitHub issues. |
| [issues.json](issues.json) | 25 issue records с scope, DoD, dependency graph, requirements/screens/files, GitHub ID/URL и честным статусом покрытия. |

## Что реализуется и что остаётся

| Область | Покрытие на текущей итерации | Остаток |
|---|---|---|
| Токены/типографика/semantic text | Изменены shared/renderer CSS, темы, Markdown и общие controls; мигрированы общие headers/settings/collection primitives. Заголовки покрывают 22/22 settings, общие карточки — 20/22. | Индивидуальный просмотр всех экранов, contrast и rich-content visual QA. |
| Rail/context navigation | Добавлены ActivityRail, контекстный LeftSidebar и компактное меню всех сервисов/панелей; повторный выбор фокусирует существующую панель. | Продуктовый keyboard/visual flow всех сервисов; настройка отдельных сложных navigator. |
| Панели 2×2/3×2 | Есть новые geometry/store/layout/menu/sash модули и изменения PanelStackContainer/PanelSlot. | Полный 4/6-panel mixed-surface QA, state/restart и native focus/visibility acceptance. |
| Диагностика | Есть collector/IPC/preload/types и UI чипа; narrow read-only контракт. | Реальные macOS/remote metric samples и native visibility; доказательство всех poll lifecycle случаев. |
| Header status / suggestions | Есть status model/lane, контекстная policy и hooks. | Актуальные итоговые tests, screen reader/visual QA, эксперимент релевантности E06. |
| Tasks/Meetings deep links | Исправлены baseline разрывы selected ID; route prop управляет выбором, а клики обновляют URL. Адресованная встреча загружается за пределами первой страницы каталога. | Приёмка на реальном сервере; автоматические проверки direct/back/forward/missing ID описаны в VERIFICATION.md. |
| Все 22 settings и прочие service screens | Общие primitives покрывают часть стиля; действия и состояния инвентаризированы. | Screen-specific миграции/QA из GG-008…024 остаются backlog; общая тема не закрывает их автоматически. |
| Native surfaces / terminal/cloud-run | Учтены существующие hosts/dock/config и parser gaps; создание отсутствующих backend сервисов не требуется. | Честная capability-деградация и реальный Electron/macOS lifecycle. |
| Visual/native release gate | [GG-025 / #578](https://github.com/rox-one/rox-one/issues/578) открыт. | Нужен разрешённый продуктовый стенд; обход текущей browser policy запрещён. |

Эта таблица фиксирует **наличие работы в исходниках**, а не завершённую приёмку. Точные статусы и ссылки — в `issues.json`; фактические результаты запусков координатор прикладывает отдельно. Базовая renderer-сборка прошла, базовый typecheck содержит 50 ошибок, базовая shell suite — 403 PASS / 2 FAIL. Снимок внешнего референса не считается снимком ROX.
