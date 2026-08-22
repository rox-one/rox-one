# Повторная live-проверка A0 — DO IT ALL (2026-08-13)

ТОЛЬКО ЧТЕНИЕ. Никаких мутаций Hermes/OMP/Tailscale. Никакого APPLY. Никакого apply.log.

| Поле | Значение |
|---|---|
| UTC | `2026-08-19T09:48:50Z` |
| Инструкция владельца | `DO IT ALL` — **не** `АПPLY HMA-20260809-A1` |
| Официальный apply.log | **не создан** |

## Полученные live-данные

| Параметр | Значение |
|---|---|
| `hermes version` | v0.20.0 (2026.8.3), upstream `c0106e50` |
| `approvals.mode` | **`off`** (P0 всё ещё активен) |
| `security.tirith_enabled` | `true` |
| `security.tirith_fail_open` | **`true`** |
| `security.allow_private_urls` | `true` |
| `skills.write_approval` | `false` |
| `memory.write_approval` | `false` |
| OMP `modelRoles.default` | `cursor/cursor-grok-4.6-xhigh` |

## Режимы файлов (только режимы)

| Имя файла (basename) | Режим |
|---|---|
| `.env.backup.telegram_home.20260708_103002` | **644** |
| `.env.backup.20260708_100905` | **644** |
| `tskey-api.secret` | **ОТСУТСТВУЕТ** (был с режимом 600 на 13:33:22Z; значение не считывалось) |

## Cron

`hermes cron list --json` не является корректным вызовом CLI (код выхода 2, usage). Имена задач или секреты в ходе этой проверки не зафиксированы.

## Syncthing / Tailscale

| Проверка | Результат |
|---|---|
| `syncthing` CLI | отсутствует в PATH |
| BackendState | Running |
| Self.HostName | `tb` |
| Self.Online | true |
| Количество пиров | 600 |
| Исходный/целевой узел | **не определён** |

## Дрейф относительно 13:33:22Z

P0 без изменений: approvals по-прежнему `off`, Tirith по-прежнему fail-open, env-бэкапы по-прежнему 644, у Tailscale по-прежнему 600 пиров, Syncthing по-прежнему отсутствует, apply.log по-прежнему отсутствует. `tskey-api.secret` теперь отсутствует в `~/.hermes` (наблюдение только по режимам; содержимое не считывалось).

## Вердикт

**FAIL CLOSED для A1–A3.** `DO IT ALL` санкционирует программу работ; для Stage C по-прежнему требуется точная строка `АПPLY HMA-20260809-A1` и указанный по имени целевой узел. Откат никогда не должен восстанавливать `approvals.mode=off`.

## Мутации

**отсутствуют**
