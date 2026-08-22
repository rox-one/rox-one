# Предполётная проверка A0 Live (R-026) — 2026-08-13

Проба READ-ONLY. Никаких мутаций Hermes/OMP/Tailscale. Секретные значения не записывались.

## Метка времени

| Поле | Значение |
|-------|-------|
| UTC | `2026-08-13T08:13:05Z` (начало пробы) |
| UTC (завершение) | `2026-08-13T08:16:03Z` |
| Hermes | `v0.20.0 (2026.8.3)` · upstream `c0106e50` · способ установки `git` |
| Код выхода `hermes version` | `0` |
| Примечание | отстаёт от upstream на 1 коммит (доступно обновление) |

## Doctor

| Метрика | Количество |
|--------|------:|
| OK (строки ✓) | 72 |
| Предупреждения (строки ⚠) | 17 |
| Сбои (строки ✗/FAIL) | 0 |
| Строк вывода | 143 |
| Код выхода | `0` |

Заметные классы предупреждений (только названия, без секретов): отсутствует опциональный пакет (`discord.py`); версия конфига устарела (v33→v34); auth: не выполнен вход (Nous Portal, MiniMax OAuth); связность: HTTP 403 (эндпоинты gemini, xai в пакете проверок connectivity); системная зависимость не удовлетворена для нескольких опциональных плагинов-инструментов (bfl, browser, browser-cdp, google_meet, hermes-yuanbao, homeassistant, image_gen, spotify).

## Config getback

| Ключ | Значение | Код выхода |
|-----|-------|-----:|
| `approvals.mode` | `off` | 0 |
| `security.redact_secrets` | `true` | 0 |
| `security.tirith_enabled` | `true` | 0 |
| `security.tirith_fail_open` | `true` | 0 |
| `security.allow_private_urls` | `true` | 0 |
| `skills.write_approval` | `false` | 0 |
| `memory.write_approval` | `false` | 0 |

## Шлюз

| Поле | Значение |
|-------|-------|
| Под наблюдением launchd | да (PID присутствует) |
| Определение службы | устарело относительно текущей установки Hermes (status предупреждает выполнить `hermes gateway start`) |
| `gateway_state` | `running` |
| Количество платформ | 3 |
| Подключено (файл состояния) | 3 |
| Отключено (файл состояния) | 0 |
| Код выхода (`hermes gateway status`) | `0` |

### Подключённые / отключённые по имени канала (файл состояния)

| Канал | Состояние | error_code |
|---------|-------|------------|
| Telegram | connected | none |
| Feishu | connected | none |
| Buzz | connected | none |

### Количество записей каталога (только имена; без ID)

| Канал | Записи |
|---------|--------:|
| Telegram | 3 |
| Feishu | 5 |
| Buzz | 1 |

### Примечание по глубокому статусу (несекретное)

Образец лога с `--deep` показывал сетевые таймауты Telegram / попытки переподключения и повторные попытки после разрывов WebSocket Buzz примерно в момент пробы, тогда как `gateway_state.json` всё ещё сообщал все три платформы как `connected`. Приведённые выше количества взяты из снимка файла состояния, а не из эвристики логов.

## Syncthing

| Проверка | Результат |
|-------|--------|
| `which syncthing` | не найден (код выхода 1) |
| `command -v syncthing` | не найден (код выхода 1) |
| `brew list syncthing` | метаданные cask присутствуют для `syncthing-app` 2.0.14-1 (путь к бандлу приложения под Caskroom); бинарник CLI отсутствует в PATH |
| Запущен | **нет** (жёсткий запрет соблюдён) |

## Tailscale (количество)

| Поле | Значение |
|-------|-------|
| BackendState | `Running` |
| Self.HostName | `tb` |
| Self.Online | `true` |
| Число пиров | `600` |
| IP-адреса / ключи / список имён пиров | **не записаны** |

## Права доступа к файлам

| Путь (только basename для чувствительных) | Существует | Режим (`%Lp`) |
|--------------------------------------|--------|--------------|
| `~/.hermes/state/tskey-api.secret` | да | `600` |
| `~/.hermes/.env.backup.telegram_home.20260708_103002` | да | `644` |
| `~/.hermes/.env.backup.20260708_100905` | да | `644` |

Содержимое не читалось. Только режимы доступа.

## Количество ошибок cron

| Метрика | Количество |
|--------|------:|
| Задач в списке | 18 |
| Последний статус `ok` | 16 |
| Последний статус `error` | 2 |
| Последний статус неизвестен | 0 |
| Код выхода `hermes cron list` | `0` |

### Задачи с последним статусом (только имя + статус)

| Последний статус | Имя задачи |
|-------------|----------|
| ok | Hermes doctor watchdog → Telegram |
| ok | Hermes disk watchdog → Telegram |
| ok | Hermes self-health watchdog → Telegram |
| ok | Hermes credential watchdog → Telegram |
| ok | Hermes daily advanced brief → Telegram |
| error | Hermes weekly surface diff → Telegram |
| ok | Hermes safe smoke-test → Telegram |
| ok | Hermes post-update startup optimizer → Telegram |
| ok | Things 3 → Lark Tasks mirror |
| ok | Daily Lark morning brief |
| ok | Daily Hermes automation audit → Lark |
| ok | Hermes OPEN session janitor |
| ok | Hermes dirty active-work resume ping |
| ok | cmux inventory → state file |
| ok | cmux inventory → Lark DM |
| ok | Codex 401 auth watchdog |
| ok | ROX surfaces health → Telegram |
| error | omniroute-gcs-snapshot-3h |

Сводка классов ошибок (без секретов): одна RuntimeError биллинга/кредитов (HTTP 403 — лимит расходов personal-team); один скрипт с кодом выхода 1 (снимок GCS — PERMISSION_DENIED / биллинг).

## Количество surface (если есть)

| Поле | Значение |
|-------|-------|
| Путь `discover_surface.py` присутствует | да |
| Вызван | да (режим read-only: `--home`, `--audit-root`, `--output /tmp/hma-a0-preflight-surface`) |
| Код выхода | `1` |
| Количество проектов | **недоступно** |
| Количества по классификации A/B/C/D | **недоступно** |
| Сбой | Первый запуск: `NameError: name 're' is not defined`. В хелпер аудита добавлен `import re`. Полный обход `$HOME` в этой сессии **не** выполнялся повторно (слишком широк; привёл бы к записи списков путей). Количества по-прежнему недоступны. |

Секретных путей не копировалось. Количество surface не получено.

## Вердикт по идентичности цели (FAIL CLOSED)

| Поле | Вердикт |
|-------|---------|
| Точный исходный узел | **не определён** |
| Точный целевой узел | **не определён** |
| ACL / diff источник–цель | **не вычислялся** |
| Токен APPLY | **не выдан** |
| Вердикт | **FAIL CLOSED** — не изобретать узел; применение миграции заблокировано, пока идентичность цели явно не установлена и APPLY не выдан |

## Выполненные мутации

**нет**

- Нет `hermes config set`
- Нет `hermes pause` / остановки шлюза
- Нет chmod для секретов
- Нет шифрования age
- Нет `~/.hermes-migration-apply`
- Syncthing не запускался
- Единственная запись: файл этого отчёта в `Projects/craft-agents/docs/security/`
- Опциональный `/tmp/hma-a0-preflight-surface` не создан (скрипт упал до записи)

## Сводка кодов выхода

| Команда | Код выхода |
|---------|-----:|
| `date -u` | 0 |
| `hermes version` | 0 |
| `hermes doctor` | 0 |
| `hermes config get` (×7) | 0 каждый |
| `hermes gateway status` | 0 |
| `hermes cron list` | 0 |
| `which syncthing` | 1 |
| `command -v syncthing` | 1 |
| `brew list syncthing` | 0 (листинг cask) |
| разбор `tailscale status --json` | 0 |
| `discover_surface.py` | 1 |

## Повторное подтверждение на живой системе (проверка цели)

| Поле | Значение |
|---|---|
| UTC | `2026-08-13T08:51:30Z` |
| `approvals.mode` | `off` — совпадает с таблицей выше; APPLY + `APPROVE A2 HERMES SMART` не выполнялись |
| `security.redact_secrets` | `true` |
| `security.tirith_enabled` | `true` |
| `security.tirith_fail_open` | `true` |
| `security.allow_private_urls` | `true` |
| `skills.write_approval` | `false` |
| `memory.write_approval` | `false` |
| `~/.hermes-migration-apply/HMA-20260809-A1/apply.log` | **ОТСУТСТВУЕТ** |
| Syncthing CLI | ОТСУТСТВУЕТ |
| Режимы env-backup | оба `644` |
| Tailscale | Running / `tb` / PeerCount `600` |
| Цель | по-прежнему **FAIL CLOSED** |
