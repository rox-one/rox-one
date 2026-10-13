# ops/main-health

Ежедневный отчёт «здоровье main» для репозитория **rox-one/rox-one** и алерт
«main красный дольше 15 минут» в Telegram. Работает **вне CI**: это локальный
скрипт + агент launchd на машине оператора.

## Что считает

За окно 24ч и 7д по ветке `main`:

1. **Доля успешных запусков workflow** — успешные / завершённые запуски GitHub
   Actions. Дополнительно приводится доля без отменённых запусков
   (concurrency-отмены не являются провалом).
2. **Время до первого зелёного** по последним merge-коммитам main: от появления
   первого запуска коммита до завершения первого успешного запуска. Выводятся
   медиана и максимум.
3. **Бюджет тестового долга** — `scripts/test-baseline.json` (`knownRed`,
   `knownRedCeiling`) и последний запуск workflow `nightly-test-all`.
4. **Топ мигающих (flaky) наборов** — workflow с повтором запуска
   (`run_attempt > 1`) и/или с разными исходами (успех и провал) на одном и том
   же коммите. Если таких нет — честно «нет данных».

Отчёт складывается в `ops/main-health/reports/main-health-YYYYMMDD.md`
(эти файлы не коммитятся). Если `gh` недоступен или GitHub API отвечает ошибкой,
это явно пишется в разделе «Ошибки» отчёта, а не проглатывается молча.

**Алерт.** «main красный» = у коммита HEAD есть завершившийся запуск с провалом
(`failure`/`timed_out`/`startup_failure`). Если это состояние длится дольше
`MAIN_HEALTH_RED_THRESHOLD_MIN` (по умолчанию 15 минут), скрипт шлёт сообщение в
Telegram. Повторно за один и тот же коммит алерт не отправляется (состояние в
`~/.local/state/rox-main-health/red-state.env`).

## Установка

1. **Env-файл с секретами** (в git не попадает):

   ```sh
   mkdir -p ~/.config/rox
   cp ops/main-health/main-health.env.example ~/.config/rox/main-health.env
   chmod 600 ~/.config/rox/main-health.env
   $EDITOR ~/.config/rox/main-health.env   # впишите MAIN_HEALTH_TG_BOT_TOKEN и MAIN_HEALTH_TG_CHAT_ID
   ```

   Токен — у [@BotFather](https://t.me/BotFather), `chat_id` — id чата/группы.
   Если env-файла нет, скрипт создаст его из образца при первом запуске (и
   предупредит в отчёте, что алерты не будут отправляться до заполнения).

2. **launchd-агент** (раз в день в 09:20):

   ```sh
   # поправьте путь к скрипту в plist, если репозиторий лежит не в ~/Projects/rox-one
   cp ops/main-health/com.agisota.rox-main-health.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.agisota.rox-main-health.plist
   launchctl print gui/501/com.agisota.rox-main-health   # проверка, что агент виден
   ```

   Логи агента: `~/Library/Logs/rox-main-health.log`.

   > Этот репозиторий **не** устанавливает агент автоматически — установка
   > выполняется вручную оператором (шаг выше).

## Запуск вручную

```sh
bash ops/main-health/main-health.sh --dry-run   # отчёт без отправки алертов
bash ops/main-health/main-health.sh             # боевой прогон (может отправить алерт)
```

Полезные опции: `--window-hours N` (глубина выборки, по умолчанию 168 = 7д),
`--repo owner/name`, `-h/--help`.

Прогон занимает ~1–2 минуты: скрипт обходит до 1000 запусков GitHub Actions за
окно (лимит пагинации API; при достижении лимита это отмечается в отчёте).

Код возврата `0` — успех, `1` — отчёт сформирован, но есть ошибки (см. раздел
«Ошибки»), `64` — неверные аргументы.

## Как читать отчёт

Файл `ops/main-health/reports/main-health-YYYYMMDD.md` состоит из разделов:

- **1. Доля успешных запусков workflow** — таблица по окнам 24ч/7д.
- **2. Время до первого зелёного** — по каждому merge-коммиту и итоги (медиана/макс).
- **3. Бюджет тестового долга** — `knownRed` против `knownRedCeiling` и последний nightly.
- **4. Топ мигающих наборов** — кандидаты на нестабильные тесты.
- **5. Статус main и алерт** — красный/зелёный, длительность и что сделал скрипт.
- **Замечания / Ошибки** — проблемы доступа к данным (например, отсутствие `gh`).

## Как отключить

```sh
launchctl bootout gui/501/com.agisota.rox-main-health
rm ~/Library/LaunchAgents/com.agisota.rox-main-health.plist
```

Отчёты и состояние остаются локально и удаляются вручную при необходимости.

## Зависимости

Только `bash`, `gh` (аутентифицированный, с доступом к репозиторию), `curl` и
стандартные утилиты (`awk`, `sort`, `date`). Новых зависимостей нет.
