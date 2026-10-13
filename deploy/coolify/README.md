# Деплой ROX (server + webui) через Coolify

Контракт деплоя единого образа `rox-server`: сервер и WebUI живут в одном
контейнере (`Dockerfile.server`, `CRAFT_WEBUI_DIR=/app/apps/webui/dist`,
порт `9100`). Отдельного деплоя WebUI не существует — «задеплоить webui»
означает «задеплоить этот образ».

## Пайплайн

```
push в main (или workflow_dispatch)
  └─ .github/workflows/server-image.yml
       ├─ build-push  → ghcr.io/rox-one/rox-server:{main, sha-<short>}
       ├─ smoke       → контейнер + GET /health (ожидается {"status":"ok"})
       └─ deploy      → deploy/coolify/deploy.sh → Coolify API (только при секретах COOLIFY_*)
```

- Образ: `linux/amd64`; теги `:main` (rolling) и `:sha-<7>` (иммутабельный — для откатов).
- Реестр: GHCR; пакет `ghcr.io/rox-one/rox-server` — **private** → Coolify нужен registry credential
  (GitHub PAT, scope `read:packages`), либо пакет переводится в public. Образ линкуется к репозиторию
  через `org.opencontainers.image.source` в `Dockerfile.server`.
- Деплой-канал считается «есть», когда настроены секреты ниже. Пока их нет — job
  `deploy` пропускается, и это `G7 = BLOCKED` по
  [`docs/agents/03-dod-gates.md`](../../docs/agents/03-dod-gates.md) (имена секретов — точные).

## Секреты репозитория

| Секрет | Обязателен | Что это |
|---|---|---|
| `COOLIFY_URL` | да | базовый URL панели Coolify (без `/` на конце) |
| `COOLIFY_API_TOKEN` | да | API-токен Coolify (Keys & Tokens; scope read+write) |
| `COOLIFY_APP_UUID` | да | UUID приложения в Coolify (source = Docker image, см. ниже) |
| `COOLIFY_SMOKE_URL` | нет | публичный URL приложения для post-deploy smoke: проверяется `<url>/health` |

Установка: `gh secret set COOLIFY_URL -R rox-one/rox-one` (и остальные по аналогии).

## Настройка Coolify-контура (один раз)

Control plane — `ops/fleet-infra` (панель Coolify + tailnet-only доступ; боевые
адреса в git не хранятся — см. принципы [`ops/fleet-infra/README.md`](../../ops/fleet-infra/README.md)).

1. **Control plane.** Развернуть панель Coolify (плейбуки `ops/fleet-infra`,
   роль `coolify-target` — для хостов-целей; регистрация целей —
   `ops/fleet-infra/scripts/register-coolify-targets.sh`, запускается НА control-плейне).
2. **Приложение.** В Coolify создать Application:
   - Source: **Docker image** → `ghcr.io/rox-one/rox-server:main` + registry credential (пакет private; PAT `read:packages`)
   - Port: `9100`; Healthcheck path: `/health`
   - Env: `ROX_SERVER_TOKEN` (**≥16 символов**, иначе сервер фатально не стартует),
     `CRAFT_ALLOWED_ORIGINS` (домен приложения); остальной контракт — `packages/server/src/index.ts`.
     Секреты среды — через Infisical/Environments, не в git.
   - Persistent volume: `/home/rox/.rox` (конфиг/состояние).
   - Домен/TLS — по политике флота (Coolify-прокси).
3. **Секреты репозитория** — таблица выше; после этого любой push в `main`
   (или `workflow_dispatch`) прогоняет канал целиком, включая деплой и smoke.

## Ручной запуск

```bash
COOLIFY_URL='https://<panel>' \
COOLIFY_API_TOKEN='<token>' \
COOLIFY_APP_UUID='<app-uuid>' \
COOLIFY_SMOKE_URL='https://<app-domain>' \
bash deploy/coolify/deploy.sh
```

Форма API-эндпоинта зависит от версии Coolify (пин `coolify_version` — в
`ops/fleet-infra/inventory/group_vars/all/versions.yml`); используемая —
`POST /api/v1/deploy?uuid=<app>` с `Authorization: Bearer`.

## Откат

- Код: revert/PR по [`docs/plans/lane-process.md`](../../docs/plans/lane-process.md) — force запрещён.
- Образ: переключить приложение в Coolify на предыдущий тег `sha-<short>` и задеплоить;
  либо `docker pull ghcr.io/rox-one/rox-server:sha-<short>` на целе и перезапуск.
- Данные: состояние — в volume `/home/rox/.rox`; откат образа данных не откатывает
  (миграции — архетип Migration в [`docs/agents/05-archetypes.md`](../../docs/agents/05-archetypes.md)).

## Статус

- [x] CI-канал сборки/публикации образа + контейнерный smoke — в этом репозитории.
- [ ] Живой Coolify-контур (control plane + target) — разворачивается по `ops/fleet-infra`;
  до его готовности `deploy`-job пропускается, G7 остаётся `BLOCKED` (имена секретов — выше).
- OPS-человеку: прод-доступы панели, домен/TLS приложения, Infra-секреты среды.
