# WP-01: строгая схема canonical Project create result

**Автономное решение 2026-09-30.** Scope — собственный response contract `WP-01.project.createShared`; 143 пакета, зависимости, acceptance и полный DoD сохраняются.

## Обнаруженное несоответствие

Исходный `plans/macro-integration/work-packages.json`, SHA256 `79988de46e07d3f5cc103d2c4ccf16d1c2a21f858d3b428a5088dcbae081eac0`, задавал для WP-01 `responseSchema.additionalProperties: false`, восемь свойств и обязательные `status`/`receiptId`. Тип `SharedProjectResult` и действующий native decoder используют существующий canonical result: `executionMode`, `lifecycle`, `verification`, `ok`, `entityId`, `receipt` вместе с исходными восемью свойствами.

Независимый actual PostgreSQL/HTTP/WS probe подтвердил HTTP 200, тот же canonical receipt по WS, одну строку Project/receipt/event и шесть дополнительных canonical полей. Исходная JSON Schema отклоняла этот действующий ответ. Доказательство: [response-schema-probe.json](../../evidence/wp01/response-schema-probe.json). Это пропущенные metadata в planning schema; runtime canonical metadata сохраняются.

## Решение

1. Изменить только `WP-01.operations[project.createShared].responseSchema`. Оставить `additionalProperties: false` и сделать обязательными все 14 полей действующего успешного ответа.
2. Успех этого конкретного bootstrap имеет `status: applied`, `executionMode: live`, `lifecycle: succeeded`, `verification: receipt_verified`, `ok: true`. HTTP/WS ошибки используют действующий error envelope и не объявляются успешным Project result. Queued/unknown/rejected не являются применённым результатом `SharedProjectResult`.
3. Добавить строгие собственные `$defs` для Project ref, Project DTO и provider receipt. Запретить неизвестные свойства на каждом уровне; проверять UUID/canonical project ID, SHA256, положительные revision/epoch, text bounds, date-time, schemaVersion, visibility и существующего provider. Общие `$defs` сохраняются; произвольный data object не разрешается.
4. Межполевая и request-context согласованность не подменяется форматами JSON Schema: command ID/hash, workspace/owner, canonical IDs, revisions и timestamps сопоставляются с действующей командой, native decoder и PostgreSQL receipt. Полные фактические ответы проверяются новым [wp-01-response-schema.test.ts](../../tests/macro-integration/wp-01-response-schema.test.ts).
5. Новый тест компилирует фактическую amended JSON Schema через установленный Ajv 8 и форматы, проверяет HTTP/WS и restart, затем повреждает только test-owned PostgreSQL receipt. Unknown/invalid/false-verified/type/hash/identity/revision/time variants должны получить безопасный `PROVIDER_UNAVAILABLE` через реальные HTTP и WS, без новой строки Project/receipt/event и приватного названия. Исходный независимый oracle и ранее сохранённые failures/receipts неизменны.

## Проверка и границы

```sh
bun test tests/macro-integration/wp-01-response-schema.test.ts
```

Тест использует существующие `ajv-formats` и его Ajv 8 dependency, а не несовместимый отдельный Ajv 6 workspace root. Установка новой production dependency не требуется. Protected PG loader, случайная собственная schema, реальный issuer и HTTP/WS остаются теми же механизмами, что у действующих WP-01 tests. Credentials не публикуются.

Исходный response schema failure, конкретные source/schema hashes и proposal run сохраняются отдельно. После root integration требуется текущий реальный test run; proposal execution не является root native acceptance. Native два профиля, offline queue/retry/cancel/restart, соответствующие reviewed screenshots и source-bound Git delivery остаются собственными открытыми gates. WP-01 и вся программа этим решением не закрываются; legal release остаётся WP-48.
