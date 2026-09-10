---
rx-id: RX-DOC-0034
title: Порт возможностей DSH-harness в Rox One
status: active
---

# Порт возможностей DSH-harness в Rox One (RX-DOC-0034)

- **Статус:** H0 и H1 закрыты. H2–H6 не начаты.
- **Дата:** 2026-09-10
- **Ветка:** `rox/session-harness-port`
- **Норматив:** [ADR-0019](../architecture/adr/0019-session-harness-capability-port.md), [спека RX-SPC-0021](../specs/2026-09-10-session-harness-port/README.md), [спокойная миграция H-04](../specs/2026-09-10-session-harness-port/04-calm-migration.md)
- **Эпик:** `RX-EPC-0001` · задачи `RX-TSK-0800`…`RX-TSK-0806`

## Зачем

DSH Desktop показал удобный harness: правая колонка как в VS Code, прогресс хода, стоимость, скиллы/MCP, дашборд контекста. Rox One — наше приложение. Фичи нужно **влить в наш UI**, а не держать второе окно.

## Как (одно решение)

Не ставим DSH внутрь Rox. Берём *возможности* и вешаем их на уже существующие слоты: Inspector, чат, Extension Center, OMP, UEW-терминал.

```
DSH plugin  →  capability  →  Panel / Surface / Skill / Source / Automation
```

## Что пользователь получит по волнам

| Волна | Что появится в UI | Опора |
|---|---|---|
| H1 | Вкладки справа: файлы, git, браузер; терминал — вкладка основной поверхности UEW, не пункт сайдбара | `RightSidebarPanel` + `SurfaceTab.terminal` |
| H2 | История ввода ↑↓, прогресс хода, cost в статус-баре, notify, «открыть в редакторе» | input + notifications |
| H3 | Дашборд контекста, нарезка MCP, честный fallback, review на permission | inspector + omp-agent |
| H4 | Один экран расширений вместо трёх списков | Extension Center |
| H5 | Импорт P0 (Grok/Claude/Codex/OpenCode/Hermes) в **Rox-сессии**, advisor, simplify | sessions + skills; scan ≠ persist |
| H6 | Явный отказ от session-buddy / mnemon / cordis-HMR | анти-цели |

Уже есть и **не копируем**: annotations, notes, superpowers, skills manager, automations, memory, paste/drag-drop, OS-notify конца хода.

Правый док в текущем UI **выключен** (`isRightSidebarVisible={false}`). `InspectorHost` живёт только при unified-shell ON. H1 включает инспектор сессии и при OFF. `SessionGitOutline` — дерево веток чата, не git: git-вкладка пишется отдельно.

Спокойный порядок, пререквизиты G0–G6 и контракт импорта (cwd `$HOME` запрещён как workspace, не писать `~/.dsh`) — в [H-04](../specs/2026-09-10-session-harness-port/04-calm-migration.md). DSH Desktop не удаляем, пока волна не зелёная.

## Чего не будет

- Процесса DSH и папки `~/.dsh` как хранилища Rox.
- npm-пакетов `dsh-*` в приложении.
- Второго чата / второго rail / iframe DSH.
- Прокси-разрешений, который на Desktop резал github.com.

## Связь с UEW

На `origin/main` уже принят Unified Execution Workbench (терминал как first-class surface, без второго агента). Перед живым терминалом в H1 ветка **должна** влить эти документы. Иначе получится третий workbench — это запрещено.
