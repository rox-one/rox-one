---
rx-id: RX-DOC-0005
title: Сборка образа и секреты BuildKit
---

# Сборка образа ROX One (BuildKit + Infisical)

Документ описывает воспроизводимую сборку серверного образа: локальный вход
`scripts/rx-build.sh`, Dockerfile `Dockerfile.build` и пайплайн CircleCI
`rx-main`. Идентификаторы: `RX-PIP-0100` … `RX-PIP-0104`, задача `RX-TSK-0600`.

Почему CircleCI, а не GitHub-hosted runners: биллинг организации блокирует
hosted-раннеры GitHub (см. комментарий в `.circleci/config.yml`).

## Как запустить локально

Нужны: Docker с BuildKit (`docker buildx`), CLI Infisical, доступ к
self-hosted Infisical.

```bash
# Домен по умолчанию уже указывает на локальный инстанс
export INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-http://127.0.0.1:18080}"

# Локально достаточно `infisical login`. В CI — machine identity:
# export INFISICAL_TOKEN=...

bash scripts/rx-build.sh
# образ: rox-one:local
```

Свой тег и платформа:

```bash
RX_IMAGE_TAG=rox-one:dev RX_PLATFORM=linux/amd64 bash scripts/rx-build.sh
```

Скрипт:

1. Создаёт каталог `mktemp -d`, пишет секреты файлами `chmod 600`.
2. Вызывает `docker buildx build --secret id=...,src=...`.
3. Удаляет каталог через `trap` на `EXIT` — даже если сборка упала.

Значения секретов в stdout не попадают: в лог идёт только имя ключа и факт
«получен / отсутствует».

Прямой вызов без скрипта (не рекомендуется: легко забыть чистку файлов):

```bash
DOCKER_BUILDKIT=1 docker buildx build \
  -f Dockerfile.build \
  --secret id=github_token,src=/path/to/github_token \
  --secret id=gh_token,src=/path/to/gh_token \
  -t rox-one:local \
  --load \
  .
```

## Какие секреты нужны и где они лежат

Проект Infisical: `c96c480c-fd39-4dbf-ae9e-f51df736ecc0`, окружение `prod`.
Инстанс: self-hosted `http://127.0.0.1:18080` (CLI: `--domain` /
`INFISICAL_DOMAIN`).

### Секреты сборки (монтируются в BuildKit)

| Ключ в Infisical | BuildKit `--secret id=` | Зачем |
|------------------|-------------------------|-------|
| `GITHUB_TOKEN`   | `github_token`          | `bun install` и скачивание релизов с GitHub (rate limit / git-deps) |
| `GH_TOKEN`       | `gh_token`              | запасной токен (аккаунт agisota); используется, если нет `GITHUB_TOKEN` |

Оба секрета **опциональны** для публичных npm-зависимостей: Dockerfile
помечает mount как `required=false`. Пустой файл = сборка без токена.

### Загрузчик Infisical (не секрет образа)

| Переменная | Где хранится | Зачем |
|------------|--------------|-------|
| `INFISICAL_TOKEN` | локальный login **или** Project Environment Variables CircleCI | machine identity / service token, чтобы CLI забрал секреты |
| `INFISICAL_DOMAIN` | env / CircleCI | URL инстанса. В облачном CircleCI это **не** `127.0.0.1` — нужен достижимый URL |

`INFISICAL_TOKEN` в образ **не** передаётся и в слои **не** попадает.

### Секреты, которые нельзя класть в образ

Ключи рантайма из того же `prod` (API поисковиков, Telegram, Postgres, MinIO,
Cloudflare tunnel и т.д.) в `Dockerfile.build` не монтируются. Их инжектируют
при запуске контейнера / агента, см. `docs/secrets-providers.md`.

## Как добавить новый секрет — три шага

1. **Infisical.** Создайте ключ в проекте `c96c480c-fd39-4dbf-ae9e-f51df736ecc0`,
   окружение `prod` (UI или `infisical secrets set ИМЯ`). Имя ключа — POSIX,
   без значения в git.
2. **`scripts/rx-build.sh`.** Добавьте `write_secret ИМЯ "$SECRET_DIR/id_файла"`
   и флаг `--secret id=id_файла,src=...` к `docker buildx build`. Не печатайте
   значение, не кладите его в ARG.
3. **`Dockerfile.build`.** В том `RUN`, которому секрет нужен, добавьте
   `--mount=type=secret,id=id_файла,required=false` и читайте
   `/run/secrets/id_файла` **внутри этого процесса**. Не добавляйте
   `ARG`/`ENV` с этим именем.

После трёх шагов секрет доступен сборке и не оседает в истории слоёв.
Документируйте ключ в таблице выше.

## Чем BuildKit-secret отличается от build-arg и почему это важно

`docker build --build-arg TOKEN=...` / `ARG TOKEN` сохраняет значение в
метаданных образа: его видно в `docker history`, кэше сборки и часто в
промежуточных слоях (`RUN echo $TOKEN` тем более). Любой, кто получил образ
или лог CI, может вытащить токен.

`RUN --mount=type=secret,id=...` монтирует файл в tmpfs **только на время
этого RUN**. Файл не копируется в слой, не становится ENV образа и не
попадает в cache key как открытое значение (ключ кэша — id секрета, не
содержимое, плюс остальные инструкции). Даже если процесс экспортировал
переменную на время `bun install`, следующий слой её уже не видит.

Поэтому для `GITHUB_TOKEN` / `GH_TOKEN` (и любого нового сборочного секрета)
разрешён только secret-mount. Build-arg оставляем для несекретных вещей вроде
`NODE_MAJOR` и `TARGETARCH`.

## CircleCI

Workflow `rx-main` (`RX-PIP-0104`) гоняет два job'а на каждом пайплайне
(push в `main` и GitHub PR):

- `rx-validate` (`RX-PIP-0103`) — `bun install --frozen-lockfile`,
  `bun run rx:validate`, затем `bun run validate:ci`.
- `rx-build-image` (`RX-PIP-0102`) — `setup_remote_docker` с
  `docker_layer_caching: true`, BuildKit, `bash scripts/rx-build.sh`.

В проекте CircleCI задайте `INFISICAL_TOKEN` и `INFISICAL_DOMAIN` (публично
достижимый URL self-hosted Infisical). GitHub-hosted runners организации
для этой работы не используем.
