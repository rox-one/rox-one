# Native Feed

Enrolled desktop users use the workspace server's Feed RPCs. Sources, fetched articles, annotations and an explicitly entered X token belong to the authenticated issuer, subject, workspace and canonical registered root. They live in private regular JSON files under the authority's state directory (`native-feed/`, mode 0700; files 0600). Legacy Electron users keep their existing device-local Feed state and credential manager.

`feed:list` only reads existing actor-owned state and safe session/automation metadata from the bound workspace. It performs no HTTP requests, creates no files and runs no migrations. Native responses omit host-global sources, credentials, unscoped renderer team activity and private automation diagnostics. The response's `refreshAllowed` flag reflects the current native write grant.

While the Feed view is mounted, its 60-second timer sends `feed:refresh` with the reserved `__due__` target for a writable native caller, then reloads `feed:list`. The server checks configured source intervals and the X timeline interval. Read-only callers only reload the list. Native polling therefore runs while Feed is open; it does not keep polling after the view closes. Source creation also polls that source once, and explicit refresh remains available. Legacy Electron retains its existing background service.

Every native write, preview and asynchronous fetch stays fenced to the original caller, workspace root and current grants. Actor-scoped writes serialize within the server. Public HTTP destinations are checked and pinned to the validated IP; Host and TLS server name retain virtual hosting and certificate checks. Configured proxies remain in use. Redirects are checked separately, and authorization is removed when the origin changes. Revoked contexts cannot commit a pending response.

Identity events clear and remount the Feed view, including source drafts and X input. Load generations and conversion receipts cannot publish into a successor actor, even during A→B→A transitions. Before writes, the renderer verifies identity and the bound window workspace again. Native view preferences use the actor's namespace.

Send-to-note supplies the created note's native revision and stable operation IDs, or the legacy opened hash and source owner. Main custody maps the opaque native creation attempt to its own canonical operation in the encrypted SQLite outbox, atomically with enqueue. The mapping survives acknowledgement and process restart. A retry must match the original actor, workspace, read/write permission fences and canonical creation content; it resubmits that exact operation for an actual server replay receipt before reading the canonical note. It never searches an existing note by title. Failed native retries retain their attempt. Send-to-task waits for the canonical personal-task receipt and retains the attempted task ID after an unknown or failed result. Success appears after acknowledgement.

Creation-attempt custody requires the create-specific `recoverCreation: true` option with a stable creation operation ID. Feed conversions opt in; ordinary Notes creation keeps its existing queue behavior with or without generic mutation metadata. Custody retains at most 4096 attempts per account/workspace, each at most 64 KiB before encryption. Capacity rejects new replayable intent without evicting accepted attempts or partially enqueuing an operation. Existing retries and ordinary creation remain available at capacity.

Verification:

```sh
bun test packages/server-core/src/handlers/rpc/__tests__/native-feed.test.ts
bun test apps/electron/src/main/__tests__/native-notes-runtime.test.ts
bun test apps/electron/src/renderer/pages/feed/__tests__/feed-caller.browser.test.ts
bun test packages/server-core/src/feed/__tests__ apps/electron/src/renderer/pages/feed/__tests__/feed-model.test.ts apps/electron/src/renderer/pages/feed/__tests__/feed-view-model.test.ts
```

The native RPC fixture uses real enrollment, authorization, WebSocket transport and private filesystem custody with synthetic HTTP responses. Chromium loads the production Feed components with frozen API descriptors. These tests verify local behavior; they do not establish live RSS or X access from the deployment environment.
