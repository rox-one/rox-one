# @rox/cloud-sdk-ts

Typed client for the Rox Cloud API (`apps/cloud-api/openapi.yaml`). One method
per documented operation, one error type for every failure, no dependencies.

```ts
import { createRoxClient } from '@rox/cloud-sdk-ts'
const rox = createRoxClient({ baseUrl: 'https://api.rox.one', apiKey: process.env.ROX_API_KEY ?? '' })
const sandbox = await rox.sandboxes.create({ os: 'linux', cpu: 2, memoryGb: 4 })
const result = await rox.sandboxes.exec(sandbox.id, 'uname -a')
console.log(result.stdout, result.exit_code)
```

## The key belongs to the customer

`apiKey` is the tenant's key. In BYOK mode it authorizes a spend on the
customer's own Daytona, Modal or E2B credential, and a `keys:write` key can mint
more keys and add provider secrets. Keep it server-side: never ship it in a
browser bundle, never put it in a URL, a log line or an error report. The client
sends it only in the `Authorization` header and scrubs it out of any error
message it builds.

## What each group does

- `sandboxes.create` always sends `Idempotency-Key` — either yours, or a fresh
  `crypto.randomUUID()`. Pass `{ idempotencyKey }` yourself when a retry must
  return the existing sandbox instead of booting a second machine.
- `sandboxes.exec` returns `{ stdout, stderr, exit_code }`; a non-zero exit code
  is a normal answer, not an error.
- `sandboxes.readFile` returns `Uint8Array`; `writeFile` accepts `Uint8Array` or
  a string (encoded as UTF-8) and resolves to `void` on the API's 204.
- `sandboxes.list({ limit, startingAfter })` returns a page with `has_more` and
  `next_cursor`.
- `keys.*`, `account.*` and `providerCredentials.*` mirror `/v1/keys`,
  `/v1/account` and `/v1/provider-credentials`. `keys.create` is the one call
  that returns a key secret, and only once.

Money is always integer cents (`balance_cents`, `cost_so_far_cents`,
`spend_cap_cents`); the `*_usd` companions are two-decimal strings. The tenant
comes from the key, never from a request body.

## Errors

Every non-2xx answer is parsed as the API envelope
`{error:{type, code, message, request_id}}` and thrown as `RoxApiError`:

```ts
import { RoxApiError } from '@rox/cloud-sdk-ts'

try {
  await rox.sandboxes.create({ os: 'linux', cpu: 8, memoryGb: 32 })
} catch (err) {
  if (err instanceof RoxApiError) {
    if (err.code === 'insufficient_balance') console.error('top up, then retry')
    else console.error(err.status, err.code, err.message, err.requestId) // message is the server's Russian text
  } else throw err
}
```

- `status` is the HTTP status, or `0` when no answer arrived.
- `code` is the machine-readable reason; branch on it, not on the message.
- `requestId` is the same `x-request-id` the failure envelope repeats — quote it
  in a support ticket.
- Two codes are local: `network_error` (DNS, socket, TLS, or the local
  `timeoutMs` deadline) and `invalid_response` (the answer did not match the
  contract).

`timeoutMs` is optional and applies per request; without it the client waits as
long as the runtime does. A server-side command deadline is `timeoutSec` on
`sandboxes.exec`.

## Tests

`bun test` runs against a fake `fetch`, so no network and no API key are needed.
