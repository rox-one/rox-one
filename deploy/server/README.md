# Деплой ROX (server + webui): GHCR-образ + docker compose

Контракт деплоя единого образа `rox-server`: сервер и WebUI живут в одном
контейнере (`Dockerfile.server`, `CRAFT_WEBUI_DIR=/app/apps/webui/dist`, порт `9100`).
Отдельного деплоя WebUI не существует.

## Пайплайн

```
push в main (или workflow_dispatch)
  └─ .github/workflows/server-image.yml
       ├─ build-push  → ghcr.io/rox-one/rox-server:{main, sha-<7>}
       ├─ smoke       → контейнер + GET /health ({"status":"ok"})
       └─ deploy      → deploy/server/deploy.sh → ssh + docker compose (при секретах DEPLOY_*)
```

- Образ: `linux/amd64`; теги `:main` (rolling) и `:sha-<7>` (иммутабельный — для откатов).
- Реестр: GHCR; пакет `ghcr.io/rox-one/rox-server` — **private** → на хосте нужен
  `docker login ghcr.io` (PAT со scope `read:packages`), либо пакет переводится в public.
- Пока секреты `DEPLOY_*` не настроены — job `deploy` пропускается (это `G7 = BLOCKED`
  по [`docs/agents/03-dod-gates.md`](../../docs/agents/03-dod-gates.md)).

## Секреты репозитория

| Секрет | Обязателен | Что это |
|---|---|---|
| `DEPLOY_HOST` | да | ssh-адрес хоста |
| `DEPLOY_SSH_KEY` | да | приватный ключ (содержимое) для ssh на хост |
| `DEPLOY_USER` | нет | пользователь (по умолчанию `root`) |
| `DEPLOY_PATH` | нет | каталог compose на хосте (по умолчанию `/opt/rox-server`) |
| `DEPLOY_SMOKE_URL` | нет | публичный URL приложения: post-deploy smoke `<url>/health` |

Установка: `gh secret set DEPLOY_HOST -R rox-one/rox-one` (и остальные по аналогии).

## Первичная настройка хоста (один раз)

```bash
# 1) Docker + compose plugin — стандартные пакеты дистрибутива
# 2) вход в GHCR (пакет private)
echo '<PAT read:packages>' | docker login ghcr.io -u <github-user> --password-stdin
# 3) каталог и файлы (docker-compose.yml — из этого каталога)
sudo mkdir -p /opt/rox-server && cd /opt/rox-server
cp docker-compose.yml .
printf 'ROX_SERVER_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env   # ≥16 символов
chmod 600 .env
docker compose up -d
# 4) реверс-прокси (Caddy): your.domain { reverse_proxy 127.0.0.1:9100 }
```

Паттерн совпадает с остальным флотом (`deploy/rox-drive-s3`, `deploy/pocket-sso`):
compose + systemd/Caddy, без дополнительных платформ.

## Ручной запуск деплоя

```bash
DEPLOY_HOST='<host>' DEPLOY_SSH_KEY_FILE=~/.ssh/deploy_key \
DEPLOY_PATH=/opt/rox-server DEPLOY_SMOKE_URL='https://<domain>' \
bash deploy/server/deploy.sh
```

## Откат

- Код: revert/PR по [`docs/plans/lane-process.md`](../../docs/plans/lane-process.md) — force запрещён.
- Образ: в `docker-compose.yml` заменить тег на предыдущий `sha-<short>` → `docker compose up -d`.
- Данные: состояние — в volume `rox-config` (`/home/rox/.rox`); откат образа данных не откатывает.

## Статус

- [x] CI-канал: сборка/публикация образа + контейнерный smoke.
- [x] Авто-деплой: ssh + docker compose, включается при секретах `DEPLOY_*`.
- [ ] Живой хост и `DEPLOY_*` — назначает владелец.
