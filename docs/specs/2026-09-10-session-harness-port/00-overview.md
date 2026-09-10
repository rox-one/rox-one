# H-00. Обзор: что переносим и куда это садится

- **Doc ID:** H-00
- **Статус:** In Review
- **ADR:** RX-ADR-0019

## 1. Реформулировка запроса

Нравится *опыт* DSH Desktop (правая панель как в VS Code, прогресс сессии, стоимость, скиллы/MCP, контекст, импорт чатов). Нужно тот же класс возможностей **в Rox One**, а не второе приложение рядом.

Целевой продукт — Electron-приложение в `apps/electron`, рантайм агента — OMP (`packages/shared/src/agent/omp-agent.ts`). UI уже трёхколоночный + правый сайдбар.

## 2. Допущения

1. Источник фич — фактически установленный desktop-профиль `~/.dsh/profiles/desktop` (29 включённых + 6 выключенных пакетов), не маркетинговый каталог GitHub `dsh-plugin`.
2. DSH остаётся референсом UX / чеклистом, не зависимостью.
3. Реализация идёт на ветке `rox/session-harness-port`. В `main` ничего не мержится, пока волна не зелёная: тесты + i18n × 10 + флаг default off.
4. UEW (терминал как first-class surface) уже принят на `origin/main`. Текущая линия `rox/ru-codex-navigation` его ещё не содержит. **H1 MUST влить UEW-спеку до кода терминала**, иначе получится третий workbench.
5. Кроссплатформенность: Electron (macOS/Linux/Windows) в первой поставке; webui/iOS — те же контракты, без отдельного DSH-порта (как UEW §15).

## 3. Границы

В скоупе: возможности из карты H-01, которые помечены `extend` или `port`.

Вне скоупа этой программы:

- Встраивание DSH / Cordis / `dsh web`.
- Routing-suite, скины, мини-игры, WeChat/OAuth-плагины DSH (их и в Desktop не ставили).
- Смена агентного бэкенда с OMP на DSH loop.
- WorkGraph kernel и WorkItem (ADR-0001, UEW M8).

## 4. Куда садится UX

Существующая геометрия Craft уже совпадает с DSH «чат + правая колонка»:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TopBar / Mode Bar                                        ⌘K   settings   │
├────────┬──────────────────────────────┬──────────────────────────────────┤
│ RAIL   │  MAIN = сессия / чат         │  INSPECTOR                       │
│        │  ChatDisplay + ChatInput     │  сегодня: files | history | none │
│        │                              │  цель H1: files · git · term ·   │
│        │                              │  browser · context · cost        │
├────────┴──────────────────────────────┴──────────────────────────────────┤
│ Status: модель · токены · стоимость · ход агента · фоновые задачи        │
└──────────────────────────────────────────────────────────────────────────┘
```

Правый слот уже типизирован:

```ts
// apps/electron/src/shared/types.ts
export type RightSidebarPanel =
  | { type: 'files'; path?: string }
  | { type: 'history' }
  | { type: 'none' }
```

H1 расширяет этот union **вкладами Inspector**, а не новым окном. Terminal-вкладка, если нужна PTY, — `SurfaceTab { kind: 'terminal' }` из UEW, не третий xterm в чате.

## 5. Рекомендуемый путь (один)

**Нативный порт возможностей на реестры Rox.**

Порядок:

1. H0 — этот ADR/спека/флаги/ветка (текущий коммит документов).
2. Влить UEW-документы с `origin/main` в эту ветку (документы + типы, без преждевременного PTY).
3. H1 — инспектор сессии (то, за что любят better-sidebar).
4. H2 — хром чата (история ввода, прогресс, cost в status, open-in-editor).
5. H3 — интеллект агента (context dashboard, MCP lens, fallbacks, auto-review).
6. H4 — довести Extension Center (skills + MCP уже почти есть).
7. H5 — advisor / simplify / workflow как skill-pack + Automation, не как Cordis.
8. H6 — явный skip списка (см. карту).

Два отвергнутых пути — в ADR-0019.

## 6. Точки вставки (уже существующие файлы)

| Слой | Путь |
|---|---|
| Shell | `apps/electron/src/renderer/components/app-shell/{AppShell,ChatDisplay,LeftSidebar,MainContentPanel}.tsx` |
| Input | `apps/electron/src/renderer/components/app-shell/input/{ChatInputZone,FreeFormInput,ToolbarStatusSlot}.tsx` |
| Правая колонка | `apps/electron/src/renderer/components/right-sidebar/`, `RightSidebarPanel` в `apps/electron/src/shared/types.ts` |
| Session workbench | `apps/electron/src/renderer/components/session-workbench/SessionWorkbench.tsx` |
| Реестры | `packages/core/src/platform/{panels,surfaces,commands,workbench}/` |
| Extensions | `packages/shared/src/extensions/` |
| Skills | `packages/shared/src/skills/`, `SkillsListPanel.tsx` |
| MCP/Sources | `packages/shared/src/sources/`, `SourcesListPanel.tsx` |
| Automations | `packages/shared/src/automations/` |
| Permissions | `packages/shared/src/agent/permissions-config.ts` |
| Annotations | `packages/ui/src/components/annotations/` |
| Notifications | `apps/electron/src/main/notifications.ts` |
| Cost | `tokenUsage.costUsd` в `apps/electron/src/renderer/atoms/sessions.ts` |
| Superpowers | `apps/electron/resources/skills/superpowers/` |
| OMP | `packages/shared/src/agent/omp-agent.ts` |
| Settings | `apps/electron/src/shared/settings-registry.ts` |
| i18n | `packages/shared/src/i18n/locales/*.json` |

Новые top-level пакеты **не** создаём (Suite S §2.3 / att2 §16).
