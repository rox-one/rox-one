# Инфраструктура аналитики: PostHog + OpenTelemetry (2026-10-09)

Статус: **развёрнуто и проверено**. Владелец: оркестратор сессии 2.

## Хост
- GCP, проект `project-66a9c35d-5049-4078-ae6`, зона `europe-west6-b`, инстанс **`rox-analytics`** (e2-custom-4-16384: 4 vCPU / 16 ГБ / 100 GB pd-balanced), статический IP **34.65.70.253** (`rox-analytics-ip`).
- Firewall `rox-analytics-web` (tcp 80/443/4317/4318, target tag `rox-analytics`). SSH: `ssh -i ~/.ssh/id_ed25519_rox root@34.65.70.253` (ключ добавлен через metadata).
- Замечание о стоимости: инстанс платный (~$100–140/мес), не входит во free-tier; использовать/остановить по решению владельца.

## PostHog (self-hosted, hobby)
- Каталог `/root` (файлы `docker-compose.yml`, `docker-compose.base.yml`, оверрайд `docker-compose.override.yml`), лог первичного деплоя `/root/posthog-deploy.log`.
- Домен: **https://posthog.rox.one** (Caddy в контейнере `root-proxy-1`, Let's Encrypt). DNS: A `posthog.rox.one` → 34.65.70.253.
- Организация `Rox`, команда `Rox App` (team id 1), пользователь `anti@mail.com`.
  - Пароль администратора: `/root/posthog-admin-password.txt` (chmod 600) на VM.
  - **Project API key (публичный, клиентский): `phc_sbFWoBoNgqGS82Q6Lone2Hvv2jVy8FMt8dFBLcBBk5X3`**
- Проверки: `POST /i/v0/e/` → 200; событие `rox_deploy_smoke` видно в ClickHouse (`select event,count() from posthog.events`), т.е. приёмка реально работает.
- Операционные правки: сервисы `capture`, `plugins`, `replay-capture` при рестарте могли выйти (exit 0) из-за «kafka stall» — в `docker-compose.override.yml` им прописан `restart: unless-stopped`.

## OpenTelemetry Collector
- Контейнер **`rox-otel`** (`otel/opentelemetry-collector-contrib:0.116.1`, `--restart unless-stopped`, сеть `root_default`, конфиг `/root/otel/config.yaml`).
- Публичный вход: **https://otel.rox.one** (Caddy `CADDY_EXTRA_CONFIG` в override → `reverse_proxy rox-otel:4318`; DNS A `otel.rox.one` → 34.65.70.253). Локально также 127.0.0.1:14317 (gRPC) и 127.0.0.1:14318 (HTTP).
- Пайплайны: `otlp` (gRPC 4317 / HTTP 4318) → `batch` → `debug` + `otlphttp/posthog` (`https://posthog.rox.one/i`, Bearer = project key).
- Проверки: `GET /v1/traces` → 405; `POST /v1/traces` → 200 и `partialSuccess:{}`; трейс `direct-smoke` (service `rox-smoke`) появился в ClickHouse (`posthog.trace_spans`), т.е. путь коллектор → PostHog ingestion → Kafka → ClickHouse подтверждён.

## Обновление
- PostHog: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/posthog/posthog/HEAD/bin/upgrade-hobby)"` (каталог `/root`).
- Коллектор: остановить `rox-otel`, удалить контейнер, повторить `docker run` (см. историю в `/root/otel/config.yaml` + перечень параметров в этом файле).

## Остаётся включить в приложении
- Десктоп/веб-клиент должны получить `POSTHOG_HOST=https://posthog.rox.one` и `POSTHOG_KEY=phc_...` (клиент отправляет события только при включённом согласии «Аналитика продукта», по умолчанию — включено). OTLP-экспорт — на `https://otel.rox.one`.
- Секретов в клиенте нет: project key — публичный по дизайну PostHog.