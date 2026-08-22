---
rx-id: RX-DOC-0024
title: Главная навигация
status: active
---

# ROX One — главная навигация (RX-DOC-0024)

ROX One — монорепозиторий десктопного AI-агента «Craft Agents»: ядро платформы, сервер, Electron-оболочка, облачный шлюз и набор интеграций. Проект ведётся по системе сквозных идентификаторов `RX-*`: каждая задача, компонент, поверхность, интеграция и документ имеют уникальный код из [легенды](../registry/RX-LEGEND.md).

Ветка волны: `rox/ru-codex-navigation`. Обновлено: 2026-08-22.

## Документация

| Код | Название | Статус | Файл |
|-----|----------|--------|------|
| `RX-DOC-0004` | [Аудит безопасности](RX-DOC-0004-security.md) | В работе | `RX-DOC-0004-security.md` |
| `RX-DOC-0005` | [Сборка образа и секреты BuildKit](RX-DOC-0005-build.md) | — | `RX-DOC-0005-build.md` |
| `RX-DOC-0006` | [Незакрытая работа из бэкапов сессий](RX-DOC-0006-sessions.md) | — | `RX-DOC-0006-sessions.md` |
| `RX-DOC-0007` | [Смежные репозитории и валидатор кодов RX-*](RX-DOC-0007-links.md) | — | `RX-DOC-0007-links.md` |
| `RX-DOC-0023` | [Консолидированные задачи](RX-DOC-0023-tasks.md) | В работе | `RX-DOC-0023-tasks.md` |
| `RX-DOC-0024` | [Главная навигация](RX-DOC-0024-hub.md) | В работе | `RX-DOC-0024-hub.md` |
| `RX-DOC-0025` | [Аудит заявленных функций](RX-DOC-0025-audit.md) | В работе | `RX-DOC-0025-audit.md` |

## Реестр

Записей суммарно: **423**. Источник: [`registry/rx-registry.yaml`](../registry/rx-registry.yaml) + [`registry/fragments/`](../registry/fragments/).

| Домен | Значение | Записей | Примеры |
|-------|----------|---------|---------|
| `CMP` | Компоненты | 68 | `RX-CMP-0001`, `RX-CMP-0002`, `RX-CMP-0003` |
| `SRF` | Поверхности | 48 | `RX-SRF-0001`, `RX-SRF-0002`, `RX-SRF-0003` |
| `TSK` | Задачи | 43 | `RX-TSK-0300`, `RX-TSK-0301`, `RX-TSK-0302` |
| `INT` | Интеграции | 35 | `RX-INT-0001`, `RX-INT-0002`, `RX-INT-0003` |
| `FEA` | Функции | 32 | `RX-FEA-0001`, `RX-FEA-0002`, `RX-FEA-0003` |
| `AUT` | Автоматизации | 30 | `RX-AUT-0001`, `RX-AUT-0002`, `RX-AUT-0003` |
| `DOC` | Документы | 25 | `RX-DOC-0001`, `RX-DOC-0002`, `RX-DOC-0003` |
| `SPC` | Спецификации | 20 | `RX-SPC-0001`, `RX-SPC-0002`, `RX-SPC-0003` |
| `PKG` | Пакеты | 19 | `RX-PKG-0001`, `RX-PKG-0002`, `RX-PKG-0003` |
| `ADR` | Решения | 18 | `RX-ADR-0001`, `RX-ADR-0002`, `RX-ADR-0003` |
| `PIP` | Пайплайны | 17 | `RX-PIP-0001`, `RX-PIP-0002`, `RX-PIP-0003` |
| `DAT` | Модели данных | 16 | `RX-DAT-0001`, `RX-DAT-0002`, `RX-DAT-0003` |
| `PLG` | Плагины | 12 | `RX-PLG-0001`, `RX-PLG-0002`, `RX-PLG-0003` |
| `API` | Контракты API | 12 | `RX-API-0001`, `RX-API-0002`, `RX-API-0003` |
| `AST` | Ассеты | 10 | `RX-AST-0001`, `RX-AST-0002`, `RX-AST-0003` |
| `SES` | Сессии | 10 | `RX-SES-0001`, `RX-SES-0002`, `RX-SES-0003` |
| `SEC` | Находки безопасности | 8 | `RX-SEC-0001`, `RX-SEC-0002`, `RX-SEC-0003` |

## Операции

- Сборка образа: `Dockerfile.build` (BuildKit), вход `scripts/rx-build.sh`; подробности — [RX-DOC-0005](RX-DOC-0005-build.md).
- CI CircleCI: workflow `rx-main` (`rx-validate` + `rx-build-image`), расписание `gateway-deploy` ежедневно 06:00 UTC.
- Гейт кодов: `bun run rx:validate`. Полный локальный контроль: `bun run validate:ci`.

## Безопасность

[RX-DOC-0004](RX-DOC-0004-security.md): находок **8** — Высокая: 1, Средняя: 4, Низкая: 3. Закрыто кодом: `RX-SEC-0001`, `RX-SEC-0002`, `RX-SEC-0003`, `RX-SEC-0006`, `RX-SEC-0007`; RX-SEC-0008 — решение D10.

## Сессии

[RX-DOC-0006](RX-DOC-0006-sessions.md): сессий разобрано **10**; извлечённые задачи — блок 0400–0599 в [списке](RX-DOC-0023-tasks.md).
Сабмодули: `vendor/rox-one-assets`, `vendor/rox-one-website` (update=none) — [RX-DOC-0007](RX-DOC-0007-links.md).

