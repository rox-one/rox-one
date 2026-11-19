# Rox Cloud — Python SDK

Клиент публичного API Rox Cloud (`apps/cloud-api/openapi.yaml`) на одной
стандартной библиотеке Python: без зависимостей, без сборки, без сети в тестах.
Нужен Python 3.10 или новее.

## Пять строк

```python
from rox_cloud import RoxClient

client = RoxClient("https://api.rox.one", "rox_sk_live_…")
sandbox = client.sandboxes.create(os="linux", cpu=2, memory_gb=4)          # idempotency key — uuid4
print(client.sandboxes.exec(sandbox["id"], "uname -a")["stdout"])
```

## Что умеет

| Раздел | Методы |
| --- | --- |
| Песочницы | `sandboxes.create`, `get`, `list`, `exec`, `read_file`, `write_file`, `stop`, `delete` |
| Ключи API | `keys.create`, `list`, `revoke` |
| Счёт | `account.get`, `top_up` |
| Ключи провайдеров | `provider_credentials.add`, `list`, `promote`, `disable` |

- `sandboxes.create(..., idempotency_key=None)` сам подставляет `uuid4` в
  заголовок `Idempotency-Key`; повтор с тем же ключом и телом возвращает ту же
  машину.
- `sandboxes.exec(...)` возвращает разобранный ответ: `stdout`, `stderr`,
  `exit_code`.
- `sandboxes.read_file(id, path)` отдаёт `bytes`, `write_file(id, path, data)`
  принимает `bytes` (или строку в UTF-8) и возвращает `None`.
- `sandboxes.list(limit=None, starting_after=None)` отдаёт страницу целиком:
  `data`, `has_more`, `next_cursor`.
- `keys.create(scopes)` возвращает секрет один раз — сохраните его сразу,
  позже API его не покажет.
- `provider_credentials.add(provider, label, secret, spend_cap_cents, regions=None, products=None)`
  шифрует ключ на сервере; обратно приходят только метаданные (`last4`,
  `fingerprint`, `status`), сам секрет не возвращается никогда.
- Ответ `204` даёт `None`.

Деньги везде целые центы (`amount_cents`, `spend_cap_cents`,
`balance_cents`). Готовые долларовые строки (`balance_usd`,
`cost_so_far_usd`) приходят как есть, строкой с двумя знаками после точки.
На проводе поля в `camelCase` (`memoryGb`, `ttlSec`, `amountCents`), в
Python — в `snake_case`.

## Ошибки

Любой сбой — это `RoxApiError` с полями `status`, `code`, `type`,
`request_id`, `message`:

```python
from rox_cloud import RoxApiError

try:
    client.sandboxes.create(provider="daytona")
except RoxApiError as err:
    print(err.code, err.request_id, err.message)
```

- `message` — текст сервера, по-русски, без перевода и без пересказа.
- `request_id` — тот самый `x-request-id`, его же повторяет конверт ошибки
  `{error:{type,code,message,request_id}}`; по нему ищут запрос в журнале.
- `code` бывает серверным (`insufficient_balance`, `permission_denied`,
  `provider_unknown`, …) или локальным: `network_error` (запрос не дошёл,
  `status` = 0) и `invalid_response` (тело не разобралось).
- Ключ API не попадает ни в сообщение, ни в `repr` клиента, ни в адрес
  запроса: он живёт только в заголовке `Authorization`.

## Тесты без сети

Клиент принимает свой транспорт — вызываемый объект
`transport(method, url, headers, body) -> (status, headers, body)`.
Поэтому тесты подставляют подделку и в сеть не ходят:

```python
from rox_cloud import RoxClient

def transport(method, url, headers, body):
    return 200, {"content-type": "application/json"}, b'{"object": "account"}'

client = RoxClient("https://api.example.test", "rox_sk_live_test", transport=transport)
```

Запуск тестов из этого каталога:

```bash
python3 -m unittest discover -s tests -v
```

## Безопасность

- Ключ API — серверный секрет. Его место в бэкенде или в скрипте, но не в
  браузере, мобильном приложении и не в публичном репозитории: оттуда он
  уходит клиенту целиком. Вызовы Rox Cloud делайте со своего сервера.
- Ключи провайдеров (Daytona, Modal, E2B) тоже не покидают сервер: SDK
  отправляет их один раз в `provider_credentials.add`, а API хранит
  шифротекст и отдаёт только метаданные.
- SDK ничего не пишет в журналы: ни ключ, ни заголовки, ни тела запросов.
