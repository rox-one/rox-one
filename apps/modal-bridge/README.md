# rox-sandbox-bridge

HTTP-мост к песочницам Modal в воркспейсе арендатора. Разворачивается один раз
в воркспейсе Rox и работает как одна ASGI-функция на Modal. Песочницы создаёт
по токену самого арендатора: ни его ключи, ни его воркспейс в коде моста не
зашиты.

```
POST   /v1/sandboxes                    создать песочницу
GET    /v1/sandboxes/{id}               состояние
POST   /v1/sandboxes/{id}/exec          выполнить команду оболочки
GET    /v1/sandboxes/{id}/files?path=   прочитать файл
PUT    /v1/sandboxes/{id}/files?path=   записать файл
POST   /v1/sandboxes/{id}/stop          остановить
DELETE /v1/sandboxes/{id}               остановить и забыть
```

## Как развернуть

```bash
modal deploy apps/modal-bridge/app.py
```

Команда печатает адрес вида `https://<воркспейс>--rox-sandbox-bridge-bridge.modal.run`.
Этот адрес кладут в настройку Rox `ROX_MODAL_BRIDGE_URL`. Каждый запрос Rox на
этот адрес несёт токен арендатора, поэтому один и тот же мост обслуживает всех
арендаторов, у каждого — свой воркспейс Modal.

## Откуда берётся токен арендатора

Токен создаёт сам арендатор в своём кабинете Modal: `https://modal.com/settings/tokens`
(либо `modal token new`). Он состоит из двух частей, `token_id` и `token_secret`,
и в хранилище ключей Rox лежит одной строкой:

```
token_id:token_secret
```

Rox отправляет его в каждом запросе:

```
Authorization: Bearer <token_id>:<token_secret>
```

Мост не проверяет токен заранее и не хранит его: он только собирает из него
клиент Modal на время одного запроса. Ни в журнал, ни в `modal.Dict`, ни в
ответ токен не попадает. В журнале остаются лишь маршрут, код ответа и наш
номер `sbx_…`.

Неверный или отозванный токен проявляется как 401 `MODAL_AUTH_FAILED` с
русским текстом — сам текст ошибки Modal наружу не отдаётся.

## Формат запросов и ответов

Создание песочницы:

```json
{"cpu": 1, "memory_mb": 1024, "gpu": "T4", "image": "python:3.12-slim",
 "timeout_sec": 900, "env": {"FOO": "bar"}, "tags": {"tenant": "acme"}}
```

`cpu`, `memory_mb` и `timeout_sec` обязательны по смыслу: `cpu` — доли ядра,
`memory_mb` — мебибайты, `timeout_sec` — срок жизни (по умолчанию 300, не больше
86400). `gpu` и `image` можно не передавать. `image` — имя образа в реестре
(`python:3.12-slim`); без него берётся `debian_slim`. Ответ — `{id, state,
created_at}`, где `id` выглядит как `sbx_` и 24 шестнадцатеричных знака.

Состояние: `starting`, `running`, `stopped`, `failed`, `expired`. `expired`
означает, что истёк `timeout_sec`; `stopped` — что процесс кончился сам или его
остановили через `stop`; `failed` — что песочница кончилась с ненулевым кодом
или пропала в Modal.

Выполнение команды: `{"command": "echo hi", "timeout_sec": 30}` → `{stdout,
stderr, exit_code}`. Строки обрезаются до 256 КиБ каждая, `exit_code` — число.
Команда исполняется через `bash -lc`. Одна команда живёт не дольше 600 секунд —
больший `timeout_sec` мост укорачивает до этого предела и до остатка срока
песочницы.

Файлы: тело `PUT` — сырые байты, ответ — 204; `GET` отдаёт сырые байты, а если
файла нет — 404 `FILE_NOT_FOUND`. Тело запроса больше 1 МиБ отклоняется с 413.

Все ошибки приходят одной формой с русским текстом:

```json
{"error": {"code": "SANDBOX_NOT_FOUND", "message": "Песочница не найдена."}}
```

## Ограничения

- Один регион по умолчанию: регион не выбирается, песочница поднимается там,
  куда её направит Modal. Задать регион можно только правкой кода.
- На бесплатном тарифе Modal GPU не выдаётся: запрос с `gpu` вернёт 400
  `MODAL_REJECTED`, пока у арендатора нет оплаченного тарифа.
- Один запущенный экземпляр моста не помнит песочницы сам — карта «наш номер →
  номер Modal» лежит в `modal.Dict` `rox-sandbox-bridge-map`, поэтому переживает
  перезапуск функции.
- Переподключение к уже созданной песочнице идёт через `Sandbox.from_id`; если
  в сборке Modal SDK такого метода нет, мост ищет песочницу по метке `rox_id`
  через `Sandbox.list`. Если и этого нет — 503 `REATTACH_UNAVAILABLE`.
- Пересборка образа на каждый запрос не кэшируется мостом: Modal сам решает,
  когда собирать `image`.
- Мост не ведёт учёт денег и не ограничивает число песочниц — это дело Rox и
  лимитов самого Modal.

## Проверка после деплоя

```bash
URL=https://<воркспейс>--rox-sandbox-bridge-bridge.modal.run
TOKEN='<token_id>:<token_secret>'

# 1. Живость (без токена)
curl -s "$URL/healthz"

# 2. Нет токена -> 401 с русским текстом
curl -s -i -X POST "$URL/v1/sandboxes" -H 'content-type: application/json' \
  -d '{"cpu":1,"memory_mb":512,"timeout_sec":300}'

# 3. Создание
curl -s -X POST "$URL/v1/sandboxes" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"cpu":1,"memory_mb":512,"timeout_sec":300}'
# -> {"id":"sbx_…","state":"starting","created_at":"…"}
SBX=sbx_…

# 4. Состояние
curl -s "$URL/v1/sandboxes/$SBX" -H "authorization: Bearer $TOKEN"

# 5. Команда
curl -s -X POST "$URL/v1/sandboxes/$SBX/exec" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"command":"echo привет && uname -a","timeout_sec":30}'

# 6. Запись и чтение файла
printf 'hello' | curl -s -i -X PUT "$URL/v1/sandboxes/$SBX/files?path=/tmp/hello.txt" \
  -H "authorization: Bearer $TOKEN" --data-binary @-
curl -s "$URL/v1/sandboxes/$SBX/files?path=/tmp/hello.txt" -H "authorization: Bearer $TOKEN"

# 7. Остановка
curl -s -i -X POST "$URL/v1/sandboxes/$SBX/stop" -H "authorization: Bearer $TOKEN"

# 8. Удаление
curl -s -i -X DELETE "$URL/v1/sandboxes/$SBX" -H "authorization: Bearer $TOKEN"
```

## Что смотреть при сбоях

- 401 `BEARER_MISSING` / `BEARER_MALFORMED` — Rox не передал заголовок или
  склеил токен не через двоеточие.
- 401 `MODAL_AUTH_FAILED` — токен арендатора отозван, просрочен или принадлежит
  другому воркспейсу.
- 400 `MODAL_REJECTED` — Modal не принял размеры (`cpu`, `memory_mb`) или GPU;
  текст причины не раскрывается намеренно.
- 502 `MODAL_FAILED` — сеть или сам Modal; повторить запрос.
- 503 `REATTACH_UNAVAILABLE` — в сборке Modal SDK нет способа поднять объект
  песочницы по номеру; нужен деплой с более новой версией SDK.
