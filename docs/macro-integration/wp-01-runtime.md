# WP-01: запуск workspace-service на Bun

## Исполняемый сервис

Сервис использует существующие `WsRpcServer`, HTTP facade, `IdentityCommands`, PostgreSQL repository, migrator и проверку криптографического Actor. Один процесс имеет один PostgreSQL pool и одну domain authority для WS и HTTP. У сервиса нет общей identity по умолчанию.

Из корня checkout:

```sh
bun run --cwd apps/workspace-service typecheck
bun run --cwd apps/workspace-service build
bun run apps/workspace-service/dist/index.js serve --config /absolute/private/workspace-service.json
```

Для разработки можно использовать `bun run apps/workspace-service/src/index.ts serve --config /absolute/private/workspace-service.json`. Существующие установленные зависимости используются без отдельной установки. Build создаёт `apps/workspace-service/dist/index.js`; рядом с каталогом `dist` должен оставаться каталог `migrations` с двумя исходными SQL migration файлами. Проверка их байтов против PostgreSQL migration history выполняется до открытия listener.

`package.json` workspace содержит команды `start`, `build`, `typecheck`, `test`. Runtime тест сам собирает актуальный executable; ручной build также доступен:

```sh
bun run --cwd apps/workspace-service build
bun test tests/macro-integration/wp-01-runtime.test.ts
```

Интеграционный тест использует существующий protected PostgreSQL test environment `/Users/t/.agents/state/rox-compound-workspace/postgres-environment.json`, отдельную случайную schema и удаляет её после проверки. Он не выводит URL или credentials. Это инфраструктура локального теста, а не источник конфигурации production CLI.

## Protected configuration

Создайте JSON файл вне checkout, принадлежащий OS account запуска сервиса, с mode `0600`. Каталог private issuer state должен находиться вне checkout, принадлежать этому account и иметь mode `0700`. CLI принимает только абсолютный путь `--config`; environment fallback отсутствует.

Пример структуры (значения заменяет host operator; реальные секреты не добавляются в repository или журналы):

```json
{
  "schemaVersion": 1,
  "database": {
    "url": "postgresql://HOST_PROVISIONED_USER:HOST_PROVISIONED_SECRET@127.0.0.1:5432/HOST_PROVISIONED_DATABASE",
    "poolSize": 12
  },
  "schema": "public",
  "serverId": "host-provisioned-workspace-service",
  "listen": { "host": "127.0.0.1", "port": 7341 },
  "authentication": {
    "mode": "local-bootstrap",
    "issuer": "urn:rox:host-provisioned-issuer",
    "audience": "rox-workspace-client",
    "algorithms": ["EdDSA"],
    "stateDirectory": "/absolute/private/workspace-issuer",
    "checkoutDirectory": "/absolute/path/to/checkout",
    "tokenLifetimeSeconds": 300
  },
  "shutdownTimeoutSeconds": 30
}
```

Database/schema должны существовать; host выдаёт сервисному DB account необходимые права на migration и domain tables. Schema identifiers ограничены строчными ASCII буквами, цифрами и `_`, начиная с буквы. Private issuer key создаётся существующим local issuer атомарно, сохраняется с mode `0600` и используется после restart. Потеря этого файла меняет issuer signing identity; сервис не генерирует общую shared identity из клиента или handshake.

Loader проверяет owner, regular file, отсутствие leaf symlink и точный mode `0600` до открытия, открывает через `O_NOFOLLOW`, сверяет inode/device и metadata, читает максимум 65,536 байт и повторно сверяет metadata. Invalid UTF-8, неизвестные поля, неверные enum/limits или конкурентное изменение приводят к постоянному безопасному error code. URL, password, file paths, SQL error и содержимое JSON не попадают в CLI diagnostic.

## Trusted issuer

Внешний issuer задаётся явно вместо `local-bootstrap`:

```json
{
  "mode": "trusted-issuer",
  "issuer": "https://HOST_PROVISIONED_ISSUER.example",
  "audience": "rox-workspace-client",
  "algorithms": ["EdDSA"],
  "keySource": {
    "jwksUri": "https://HOST_PROVISIONED_ISSUER.example/.well-known/jwks.json"
  }
}
```

Разрешены `EdDSA`, `RS256`, `PS256`, `ES256`. `keySource` содержит либо фиксированный публичный `jwks` (максимум 16 asymmetric keys, без private fields), либо фиксированный HTTPS `jwksUri`. Только для явного loopback fixture допускается HTTP URI вместе с `"allowLoopbackHttp": true`. JWT headers не выбирают endpoint. Local credential endpoint и `bootstrap-account` в trusted mode недоступны.

Host integration внешнего issuer должна заранее обеспечить immutable `(issuer, subject) → principal` alias и persisted server session через существующие administration ports. Один только подпись JWT не создаёт membership или session. CLI не предоставляет запасной путь через email/profile/произвольный Actor.

## TLS

При любом host, кроме точных `127.0.0.1`, `::1`, `localhost`, конфигурация без TLS отклоняется до listener. Добавьте top-level:

```json
{
  "tls": {
    "certificateFile": "/absolute/private/server.crt",
    "keyFile": "/absolute/private/server.key"
  }
}
```

Оба файла должны пройти тот же owner/regular/no-symlink/mode `0600` контроль; лимит каждого — 262,144 байт. Опциональны `caFile` и `passphrase` внутри protected config. Один HTTPS listener принимает HTTP и WSS. Local credential route дополнительно проверяет loopback peer независимо от bind host. Production clients должны проверять TLS certificate chain; тестовый self-signed certificate используется только в isolated subprocess test.

## Привилегированное provisioning через stdin

Administration команды предназначены для host operator, имеющего private config и DB privilege; они не регистрируются как RPC/HTTP routes.

```sh
bun run apps/workspace-service/dist/index.js bootstrap-account --config /absolute/private/workspace-service.json
bun run apps/workspace-service/dist/index.js bootstrap-workspace --config /absolute/private/workspace-service.json
```

Подайте одну JSON структуру через stdin из host secret input tool, закройте stdin в течение 5 секунд. Не используйте raw password CLI arguments, shell history, здесь-документ с реальным password или сохранённый temporary password JSON.

- `bootstrap-account` принимает ровно `{"login":"host-login","password":"password from host secret input"}`. Password длиной 12–4096 символов передаётся существующему `PostgresIdentityAuth.provisionAccount`, сохраняется только Argon2id hash. Выход содержит `event`, UUID `principalId`, UUID `subject`; login/password не выводятся.
- `bootstrap-workspace` принимает ровно `{"ownerPrincipalId":"UUID","workspaceId":"UUID","name":"Workspace name"}`. Owner должен существовать. Existing repository выполняет workspace/member/event provisioning transaction. Выход содержит только `event`, UUID `workspaceId`, UUID `ownerPrincipalId`.
- Ограничение stdin — 65,536 байт, unknown fields отклоняются. Invalid privileged input проверяется до открытия PostgreSQL pool. Ошибка не выводит исходный input.

Local token выдаётся существующим loopback `POST /v1/auth/local/token`. Protected routes используют `Authorization: Bearer` и живые persisted session/membership checks. CLI не выводит token или password и не предоставляет session-revocation bypass.

## Lifecycle и recovery

Сервис печатает одну безопасную JSON строку `{"event":"listening","protocol":"http","port":7341}` после успешного открытия listener. `SIGTERM`/`SIGINT` прекращают admission, закрывают listener, ждут все уже принятые HTTP operations, WS authentication phases и WS domain commands, затем закрывают pool без cancellation timeout. Повторный signal не прерывает этот drain.

`shutdownTimeoutSeconds` задаёт диагностический срок, а не разрешение уничтожить принятую transaction. При превышении печатается `SHUTDOWN_DRAIN_TIMEOUT`, процесс продолжает безопасно ждать и после drain завершится с code `1`. В нормальном случае печатается `{"event":"stopped"}`, exit code `0`. Не применяйте принудительный kill до разрешения удерживаемых host DB locks, если необходимо сохранить принятую операцию.

WS может потерять reply при закрытии connection. После restart retry того же immutable command и idempotency key получает исходный receipt, canonical project ref и event outcome. HTTP accepted request может завершиться во время drain. Изменённый payload со старым key остаётся conflict. Private title не входит в membership/ref event payload.

Десять runtime tests проверяют реальный source и built executable, two crypto accounts, Argon2id storage, WS→HTTP canonical read, private403, persisted issuer JWK, original receipt и cursor после restart, pinned trusted JWKS, non-loopback HTTPS, SIGINT, и SIGTERM при PostgreSQL session-row lock. Negative control с исходным server без lifecycle tracking вернул `401` после освобождения lock вместо `200`; этот status assertion сохранён. UI acceptance и release integration проверяются root отдельно.


## Bootstrap observability: только внутренний host port

`createWorkspaceServer(...).observability.snapshot()` возвращает immutable snapshot из десяти фиксированных числовых агрегатов. Этот port не зарегистрирован в HTTP/RPC и не возвращает private totals, principal/workspace/consumer labels, command IDs, payload, email или JWT. Реализация использует существующий `RpcCallCounter` через закрытый fixed-label adapter; PostgreSQL receipt/event/inbox остаются единственным durable источником результата.

| Counter | Реальное условие |
|---|---|
| `projectApplied` | Транзакция действительно завершила новое создание Project + receipt + event. |
| `projectReplayed` | После текущей session/policy проверки транзакция вернула сохранённую оригинальную квитанцию. |
| `projectConflicts` | DB/receipt branch отклонил несовместимый commandId/idempotencyKey/hash с `IDEMPOTENCY_CONFLICT`. |
| `projectFailed` | Принятая repository-транзакция отклонена по другой причине. Ошибки parse/hash до транзакции не входят. |
| `consumerCommitted` | Effect, inbox и watermark успешно закоммичены одной транзакцией. |
| `consumerFailed` | Consumer-транзакция отклонена; failed effect не считается commit. |
| `consumerRetried` | Повторная попытка того же consumer/event после наблюдавшейся ошибки в этом процессе закончилась commit или очередной ошибкой. |
| `consumerEmptyPolls` | Durable query не нашёл следующего события. |
| `consumerInboxDeduplicatedPolls` | Empty poll при наличии уже сохранённого inbox данного consumer; это число deduplicated polls, не число всех пропущенных rows. |
| `retryTrackingEvictions` | Ограниченный process retry index вытеснил старую failure fingerprint. |

Retry attribution хранит максимум `MAX_RETAINED_CONSUMER_FAILURES` SHA256 fingerprints пары consumer/event; они никогда не попадают в snapshot/log. Это диагностическое process state, не второй inbox и не durable retry scheduler. При новом процессе counters и retry attribution начинаются с нуля; после restart или eviction количество retries является нижней оценкой. Ошибка между commit и process observation может не попасть в агрегат: восстановление результата опирается на PostgreSQL, а не на telemetry.

После SIGTERM/SIGINT CLI сначала закрывает admission и дожидается accepted I/O и SQL close, затем пишет один JSON record `event: identity_counters` с этими fixed numeric fields и последний `event: stopped`. SIGKILL/power loss не гарантируют выдачу финального record. Привилегированный host может собирать stdout:

```sh
bun apps/workspace-service/src/index.ts serve --config /absolute/protected/workspace-service.json > /absolute/private/workspace-service.log
```

Файл config сохраняется с mode `0600`; log хранится по host policy в защищённом каталоге. Не передавайте URL/пароли через argv и не печатайте config. Running host может читать internal `observability.snapshot()` без публичного endpoint. Не добавляйте diagnostic HTTP route: aggregate usage не является разрешённым клиентским total.

Persisted `command_id`, event `causation_id`/`correlation_id`, `aggregate_revision`/`policy_epoch` и `project_projection_watermark` проверяются в domain/service integration tests. Их существование не заявляет полный telemetry backend, queue-lag SLO или universal DLQ. Bootstrap consumer делает transactional retry после ошибки и durable inbox dedup. Generic scheduler/backoff/DLQ, retention и export принадлежат WP-04 / WP-47; DLQ не реализован и не выдаётся за нулевую очередь.

Проверка механизма:

```sh
bun test tests/macro-integration/wp-01-observability.test.ts
```

Тест использует actual composed service, real JWT/Argon2 accounts, защищённый локальный PostgreSQL, concurrent command repeats, SQL-trigger rollback, effect exception→retry, inbox/watermark readback, и source CLI subprocess shutdown. Отдельные mutants должны провалить oracle при преждевременном счётчике commit и потерянном retry attribution. Исходные падения и hashes сохраняются в revision-bound receipt.


## WP-01: durable create-only offline intent в native Projects

В существующих Connections пользователь вводит адрес workspace-service, UUID server workspace, точное имя workspace, login и password. После реального login main получает `/v1/workspaces/{UUID}/identity` с Bearer credential: HTTP facade проверяет криптографический Actor, текущую session и membership перед ответом. Renderer не читает JWT claims и не сохраняет JWT/password. Проверенный scope содержит issuer, principal/session/device/workspace UUID и срок действия; его fingerprint привязан к точным encrypted credential и конфигурации. Старый direct-provisioned credential без такого login не получает offline eligibility автоматически.

Создание Project сначала сохраняет один encrypted intent для локального workspace через существующий strict CredentialManager. Intent содержит неизменяемые commandId, idempotencyKey, payload и привязку к проверенному scope. Запись durable завершается до первой отправки. Это ограниченный механизм `domain.project.createShared`, а не общая command queue. Второй draft не заменяет retained intent; UI показывает явное предупреждение и предлагает повтор или отмену повтора.

При потере сети или после перезапуска Electron собственный непросроченный intent отображается как `offline_queued` либо `uncertain`. Автоматической отправки после reconnect/restart нет. Пользователь нажимает «Повторить»: main заново запрашивает проверенный identity, сверяет полный scope и текущую operation generation, durable записывает uncertain, затем отправляет исходную command через существующий WS transport. Перед локальным acknowledgement проверяется свежая session/membership. PostgreSQL receipt обеспечивает тот же результат для того же idempotencyKey; uncertain reply не создаёт новый commandId/key.

Cached scope позволяет сохранить intent в offline UI, но не разрешает server side effect. Offline клиент не может узнать о remote revoke до восстановления связи. При online retry revoke/membership removal, смена session/principal/workspace, expired proof или auth rejection дают blocked без title/payload. Wrong-password replacement сохраняет canonical credential/config bytes, но quiesces live connection и текущий create scope до успешной replacement authentication. Explicit disconnect удаляет recognized pending/proof и canonical credential/config через существующий generation lock/journal. Unknown encrypted record formats сохраняются byte-for-byte и блокируют операции.

«Отменить повтор» удаляет retained intent после строгой проверки формата. Эта операция не отменяет уже committed server Project, если reply был потерян. Для разблокирования quarantined intent другой сессии доступно явное удаление повтора, без показа приватного названия. Credentials, proof и intent используют те же canonical encrypted store/backend и локальную journal recovery; дополнительной identity authority или plaintext secret storage нет.

Main IPC привязан к actual local window workspace. `getSharedProjectCreateIntent`, `queueSharedProjectCreate`, `retrySharedProjectCreate`, `cancelSharedProjectCreate` возвращают safe typed states: none, queued, uncertain, blocked или applied. Только queued/uncertain содержит command; blocked не содержит private title или scope. Identity HTTP route не принимает query/body, чужой scope, Actor/principal claims.

Проверка механизма:

```sh
bun test tests/macro-integration/wp-01-offline.test.ts
```

Тест использует actual workspace-service composition, isolated PostgreSQL schema и две migration, Argon2 accounts/JWT, HTTP/WS, encrypted v3 profile без OS keychain CLI, реальные Bun main-child process и SIGKILL. Test-owned checkpoint оборачивает existing durable credential write после записи, не добавляет production hook. Transparent test proxy теряет actual WS reply после server commit. Проверяются 0 SQL effects до retry, 1 Project/1 receipt/1 project.created после explicit retry, неизменные IDs/key/hash, cancel/restart, revoke/membership/session/principal fences, unknown format preservation и wrong-password quiesce. Process SIGKILL проверен; физический power loss и одновременные независимые main writers одного profile этой проверкой не подтверждены. Native Electron UI acceptance и final143 program gate имеют отдельные receipts.
