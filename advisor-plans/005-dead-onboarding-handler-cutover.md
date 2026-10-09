# Plan 005: Cut over to the live onboarding handler and delete the dead Electron duplicate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4418fca40..HEAD -- apps/electron/src/main/onboarding.ts apps/electron/src/main/rox-connect-flow.ts apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts apps/electron/src/main/__tests__/rox-connect-flow.test.ts packages/server-core/src/handlers/rpc/onboarding.ts packages/server-core/src/handlers/rpc/index.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `4418fca40`, 2026-10-09

## Why this matters

`apps/electron/src/main/onboarding.ts` is a full copy of the onboarding RPC
handlers that **nothing in production registers** — the live copy is
`packages/server-core/src/handlers/rpc/onboarding.ts`, registered by
`packages/server-core/src/handlers/rpc/index.ts:127`. The main copy is loaded
only by one test (`native-rox-cloud-connect.test.ts`), so the app boots with
the server-core implementation while the test keeps proving the behavior of a
file that never runs in the product. That is worse than dead code: the two
copies have already diverged (different channel lists, different cloud-account
model), so the test is green on a straw man. Deleting the duplicate removes
~300 lines of rot and forces the only consumer test to exercise the code that
actually ships.

## Current state

The facts the executor needs, inlined.

### 1. The dead Electron copy (to be deleted in step 3)

`apps/electron/src/main/onboarding.ts` — defines `registerOnboardingHandlers`
and the 13-channel `HANDLED_CHANNELS` list:

```ts
// apps/electron/src/main/onboarding.ts:27-41
export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH,
  RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE,
  RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
  RPC_CHANNELS.onboarding.START_ROX_CONNECT,
  RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE,
  RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD,
  RPC_CHANNELS.onboarding.GET_ROX_BALANCE,
  RPC_CHANNELS.onboarding.SAVE_OMP_CREDENTIAL,
] as const

// apps/electron/src/main/onboarding.ts:43
export function registerOnboardingHandlers(server: RpcServer, deps: HandlerDeps): void {
```

It imports the private flow shim:

```ts
// apps/electron/src/main/onboarding.ts:21
import { RoxConnectFlow } from './rox-connect-flow'
```

### 2. The shim (to be deleted in step 3)

`apps/electron/src/main/rox-connect-flow.ts` is a one-line re-export:

```ts
// apps/electron/src/main/rox-connect-flow.ts:1
export { RoxConnectFlow, type RoxConnectFlowDependencies } from '@rox/shared/auth'
```

`@rox/shared/auth` already re-exports the real class
(`packages/shared/src/auth/index.ts:20` → `export * from './rox-connect-flow.ts';`),
so the shim adds no behavior. Its only importers are
`apps/electron/src/main/onboarding.ts:21` and the test
`apps/electron/src/main/__tests__/rox-connect-flow.test.ts:2`.

### 3. The live handler (read-only for this plan)

`packages/server-core/src/handlers/rpc/onboarding.ts` defines the same export
name with a **14-entry** channel list (the audit's "15" is wrong). It differs
in exactly two ways that matter here:

```ts
// packages/server-core/src/handlers/rpc/onboarding.ts:25-40
export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.START_ROX_CONNECT,
  RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE,
  RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD,
  RPC_CHANNELS.onboarding.ENSURE_FIRST_SESSION,   // extra: not in the main copy
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH,
  RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE,
  RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
  RPC_CHANNELS.onboarding.SAVE_OMP_CREDENTIAL,
  RPC_CHANNELS.onboarding.GET_ROX_BALANCE,
] as const
```

Everything in the main copy's list is also in this list; the server-core list
adds `ENSURE_FIRST_SESSION`. **No channel name is added, removed, or renamed
relative to the main copy** — this is a dedup, not a behavior change.

The load-bearing difference is the Rox cloud account: the main copy keeps
per-caller `RoxConnectFlow` instances and stores sessions via
`getCredentialManager()`; the live copy delegates to a process-wide
`RoxAccountAuthority` singleton:

```ts
// packages/server-core/src/handlers/rpc/onboarding.ts:229-238
const caller = (ctx: import('@rox/server-core/transport').RequestContext) => ctx.principal
  ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER
server.handle(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE, ctx => getRoxAccountAuthority().state(caller(ctx)), { access: 'nativeOrLocalElectron', nativeAction: 'read' })
server.handle(RPC_CHANNELS.onboarding.START_ROX_CONNECT, async ctx => {
  try {
    const started = await getRoxAccountAuthority().start(caller(ctx))
    ...
```

`getRoxAccountAuthority()` throws `ROX_OS_SECURE_STORAGE_UNAVAILABLE` when no
singleton has been installed (`packages/shared/src/auth/rox-account-authority.ts:279`),
and production installs it in `apps/electron/src/main/index.ts:1153`. **A test
that loads the server-core handler must install one too.** That is the whole
reason the fixture needs editing.

### 4. Why the dead copy is dead

- The production registration graph never imports it:
  `apps/electron/src/main/handlers/index.ts:42` calls `registerCoreRpcHandlers`
  (which registers the server-core onboarding copy), and the local GUI
  registrations that follow (`registerGuiRpcHandlers`, lines 20-30) contain no
  onboarding handler.
- `packages/server-core/src/handlers/rpc/index.ts:24` imports and `:127`
  registers the live copy.
- The only reference to the dead copy anywhere is the fixture's inline
  subprocess script, which imports it by a **cwd-relative** path (the
  subprocess runs with `cwd` set to the repo root at
  `native-rox-cloud-connect.test.ts:77`):

```ts
// apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts:16
const {registerOnboardingHandlers}=await import('./apps/electron/src/main/onboarding.ts');
// apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts:41
 registerOnboardingHandlers(server,{platform:{logger:{info(){},warn(){},error(){},debug(){}}},nativeData:{authority}});
```

### 5. The harness pattern to copy (server-core)

`packages/server-core/src/handlers/rpc/__tests__/onboarding.test.ts:103-134`
builds a fake `RpcServer` and calls the live registrar. The fixture is a
different kind of test (real `WsRpcServer` + real credentials, in a spawned
subprocess), but it must register the same module the same way: pass a server
and a deps object to `registerOnboardingHandlers`. Quote of the pattern:

```ts
// packages/server-core/src/handlers/rpc/__tests__/onboarding.test.ts:103-134
async function createHarness() {
  // This module must load after Bun installs the isolated auth/config seams;
  // a static import would bind the real credential and OAuth implementations.
  const { registerOnboardingHandlers } = await import('../onboarding')
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
  } as unknown as RpcServer
  const deps = {
    sessionManager: {
      ensureFirstSessionWelcome: async (workspaceId: string) => {
        welcomeWorkspaceCalls.push(workspaceId)
        return { id: 'welcome', messages: [{ role: 'assistant', content: 'Hello' }] }
      },
    },
    platform: {
      logger: { info() {}, error() {}, warn() {}, debug() {} },
    },
  } as HandlerDeps

  registerOnboardingHandlers(server, deps)

  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`missing handler for ${channel}`)
    return handler({}, ...args)
  }

  return { invoke }
}
```

The fixture's inline script must install a real `RoxAccountAuthority` over an
**in-memory** `PocketAccountStore` and pass a `deps` object with
`platform.logger`, `sessionManager`, and `nativeData`.

### 6. The real Pocket protocol the fixture stubs must speak

The live authority talks to the broker via
`packages/shared/src/auth/rox-pocket-client.ts` (base URL from
`getRoxAuthBaseUrl()`, which honors `ROX_AUTH_BASE_URL` — the fixture already
sets `ROX_AUTH_BASE_URL: 'https://auth.example.test'`). The fixture's existing
`globalThis.fetch` stub speaks the **old** `startRoxDeviceFlow` protocol and
will not satisfy it. Required paths and payload shapes:

| Method + path | Required response fields (validated in `rox-pocket-client.ts`) |
|---|---|
| `POST /api/auth/device/v2/start` | `device_code`, `user_code`, `verification_uri` (must be same-origin as base, pathname `/login/device`, exactly one param `v=2` plus optional `user_code`, no hash), `expires_in > 0`, `interval` |
| `POST /api/auth/device/v2/poll` | approved: `status:'approved'`, `access_token`, `refresh_token` (both non-empty strings), `token_type:'Bearer'`, `expires_in > 0`, `user.id` + `user.email` strings; pending: `status:'pending'` |
| `POST /api/me/bootstrap` (bootstrap) / `GET /api/me/account` (normal) | `state` in `authenticated\|provisioning\|ready\|failed`; `user.id` must equal the stored `accountId`; `organization.id`, `organization.role` strings; `user.email` string, `user.emailVerified` boolean; `balance.currency === 'ROX'` and `balanceRox`/`heldRox`/`availableRox` strings matching `/^\d+\.\d{6}$/`; `updatedAt` string; optional `key` object |
| `POST /api/me/inference-credential` | `accountId` equal to snapshot user id, `keyId` equal to snapshot `key.id`, `generation` equal to snapshot `key.generation`, non-empty `apiKey`, `baseUrl === 'https://api.rox.one/v1'` |
| `POST /api/auth/device/v2/logout` | any JSON object, HTTP 200 |

`state().connected` is true only when the snapshot has `state:'ready'` **and**
the key is `status:'active'` **and** a credential was fetched — so the stub
must serve bootstrap/account **and** inference-credential. `GET_ROX_BALANCE`
returns `{ status:'ok', balance: Number(snapshot.balance.availableRox), ... }`
(`onboarding.ts:243-250`); a `'12.500000'` available balance therefore yields
`balance === 12.5`.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Fixture (subprocess integration) | `bun test apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts` | `1 pass`, `0 fail` |
| Live onboarding unit tests | `bun test packages/server-core/src/handlers/rpc/__tests__/onboarding.test.ts` | `9 pass`, `0 fail` |
| Flow-unit test (re-pointed) | `bun test apps/electron/src/main/__tests__/rox-connect-flow.test.ts` | `5 pass`, `0 fail` |
| Orphan guard (new) | `bun test packages/server-core/src/handlers/rpc/__tests__/onboarding-registration-orphans.test.ts` | `2 pass`, `0 fail` |
| Electron typecheck | `bun run typecheck:electron` | exit 0, no errors |
| Shared typecheck | `bun run typecheck:shared` | exit 0, no errors |

## Scope

**In scope** (the only files you may modify):
- `apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts` (migrate)
- `apps/electron/src/main/__tests__/rox-connect-flow.test.ts` (re-point import)
- `apps/electron/src/main/onboarding.ts` (delete, step 3)
- `apps/electron/src/main/rox-connect-flow.ts` (delete, step 3)
- `packages/server-core/src/handlers/rpc/__tests__/onboarding-registration-orphans.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `packages/server-core/src/handlers/rpc/onboarding.ts` and `index.ts` — the
  live logic and its registration are correct; this plan only reads them.
- Any IPC channel name or `RPC_CHANNELS` entry — the channel contract is frozen.
- `apps/electron/src/main/index.ts` — the production authority bootstrap.
- `packages/shared/src/auth/**` — the authority and pocket client are correct.
- `packages/core/src/rox2/**` — the `isClaimableLive` gates.

## Git workflow

- Branch: `advisor/005-dead-onboarding-handler-cutover` (repo uses conventional
  commit subjects, e.g. `test(shell): re-anchor the sash geometry pin to the
  shipped tokens`). Suggested commits:
  - `test(electron): exercise the server-core onboarding handlers in the Rox connect fixture`
  - `refactor(electron): delete the unregistered onboarding handler copy and its shim`
  - `test(server-core): guard against duplicate onboarding registrar exports`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Migrate the fixture to register the server-core handlers

Edit the inline subprocess script in
`apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts`. Keep the
outer test unchanged except for the module path and the synthetic-protocol
details below. **Do not delete the test.**

Target shape for the script (adapt payloads if a validator rejects one — see
STOP conditions; do not weaken an assertion):

```js
const {mkdirSync,readFileSync}=await import('node:fs');
const {join}=await import('node:path');
const {randomUUID}=await import('node:crypto');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerOnboardingHandlers}=await import('./packages/server-core/src/handlers/rpc/onboarding.ts');
const {RoxAccountAuthority,setRoxAccountAuthority,LOCAL_ROX_CALLER}=await import('./packages/shared/src/auth/rox-account-authority.ts');
const {getCredentialManager}=await import('./packages/shared/src/credentials/manager.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const {updatePreferences,ensureLocalUserIdentity}=await import('./packages/shared/src/config/preferences.ts');
const assert=(value,message)=>{if(!value)throw Error(message)};
const denied=async fn=>{let rejected=false;try{await fn()}catch{rejected=true}assert(rejected,'expected denial')};
const state=join(process.env.CRAFT_CONFIG_DIR,'state');
// ... NativeAuthority bootstrap, workspaces, enrollment, grants, preferences: unchanged from the current file ...
```

Then replace the cloud wiring (the block that currently constructs
`registerOnboardingHandlers(server,{...nativeData:{authority}})` and the
`globalThis.fetch` stub) with the in-memory authority + real-pocket-protocol
stub below:

```js
const records=new Map();
const ownerKey=o=>JSON.stringify([o.issuer,o.subject]);
const accountStore={
  readLogout:async c=>records.get('logout:'+ownerKey(c))??null,
  writeLogout:async (c,r)=>{records.set('logout:'+ownerKey(c),r)},
  clearLogout:async c=>{records.delete('logout:'+ownerKey(c))},
  read:async c=>records.get('account:'+ownerKey(c))??null,
  write:async (c,r)=>{records.set('account:'+ownerKey(c),r)},
  clear:async c=>{records.delete('account:'+ownerKey(c))},
};
setRoxAccountAuthority(new RoxAccountAuthority(accountStore));
const readySnapshot=id=>({state:'ready',user:{id,email:'synthetic@example.test',emailVerified:true,name:'Synthetic',handle:null,profileUrl:null},organization:{id:'org-1',name:null,slug:null,role:'owner'},balance:{currency:'ROX',balanceRox:'12.500000',heldRox:'0.000000',availableRox:'12.500000',bonusStatus:'none'},key:{id:'key-'+id,prefix:'rox_key',generation:1,status:'active'},updatedAt:'2026-01-01T00:00:00.000Z'});
// The host has its own account under LOCAL_ROX_CALLER; actors must never inherit it.
await accountStore.write(LOCAL_ROX_CALLER,{accountId:'host-private-user',authGeneration:'host-generation',accessToken:'synthetic-host-token',refreshToken:'host-refresh-token',expiresAt:Date.now()+3600000,snapshot:readySnapshot('host-private-user'),credential:{accountId:'host-private-user',keyId:'key-host-private-user',generation:1,apiKey:'host-api-key',baseUrl:'https://api.rox.one/v1'},lastSyncedAt:Date.now()});
const proofs=new Map(); const clients=[]; let server;
const start=async()=>{
  server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,validateToken:async token=>token==='fixture-legacy-token',resolveLocalClientBinding:candidate=>proofs.get(candidate.localClientProof)??null});
  registerOnboardingHandlers(server,{platform:{logger:{info(){},warn(){},error(){},debug(){}}},sessionManager:{ensureFirstSessionWelcome:async workspaceId=>({id:'welcome',messages:[{role:'assistant',content:'Hello '+workspaceId}]})},nativeData:{authority}});
  await server.listen();
};
// client(...) helper: unchanged
let devices=0; let approve=true;
globalThis.fetch=async(url,init)=>{
  const href=String(url);
  const token=String(init?.headers?.authorization??'').replace('Bearer ','');
  const accountId=token==='synthetic-host-token'?'host-private-user':token.replace('synthetic-token-','');
  const payload=JSON.parse(String(init?.body??'{}'));
  if(href.endsWith('/api/auth/device/v2/start'))return new Response(JSON.stringify({device_code:'synthetic-device-'+(++devices),user_code:'TEST-'+devices,verification_uri:'https://auth.example.test/login/device?v=2&user_code=TEST-'+devices,expires_in:60,interval:2}),{status:200});
  if(href.endsWith('/api/auth/device/v2/poll'))return new Response(JSON.stringify(approve?{status:'approved',access_token:'synthetic-token-'+payload.device_code,refresh_token:'synthetic-refresh-'+payload.device_code,token_type:'Bearer',expires_in:60,user:{id:payload.device_code,email:'synthetic@example.test',name:null}}:{status:'pending',interval:2}),{status:200});
  if(href.endsWith('/api/me/bootstrap')||href.endsWith('/api/me/account'))return new Response(JSON.stringify(readySnapshot(accountId)),{status:200});
  if(href.endsWith('/api/me/inference-credential'))return new Response(JSON.stringify({accountId,keyId:'key-'+accountId,generation:1,apiKey:'synthetic-api-key',baseUrl:'https://api.rox.one/v1'}),{status:200});
  if(href.endsWith('/api/auth/device/v2/logout'))return new Response(JSON.stringify({ok:true}),{status:200});
  if(href.endsWith('/api/auth/device/v2/refresh'))return new Response(JSON.stringify({status:'approved',access_token:'synthetic-token-'+accountId,refresh_token:'synthetic-refresh-'+accountId,token_type:'Bearer',expires_in:60,user:{id:accountId,email:'synthetic@example.test',name:null}}),{status:200});
  throw new Error('Unexpected synthetic auth request: '+href);
};
```

Keep every behavioral assertion the fixture already makes, with these
protocol-driven adjustments:

- Line 59 still seeds a legacy host credential via
  `manager.setRoxCloudSession({accessToken:'synthetic-host-token',userId:'host-private-user',...})`
  and line 68 still asserts it is untouched — that assertion now proves the
  server-core handler does not write the legacy host credential store.
- Line 61's expected fallback link changes to the real device URL:
  `assert(grant.success&&grant.verificationUriComplete==='https://auth.example.test/login/device?v=2&user_code=TEST-1','device start failed or fallback link missing')`.
- Lines 60/62/63/64/66/67/68/69/70/71/72 keep their current assertions and
  messages verbatim (isolation, no raw token, per-actor `user.id`, logout
  isolation, remote denial, late-approval-after-logout, preferences untouched).
- Line 65's `.balance===12.5` stays correct (see the `GET_ROX_BALANCE` mapping
  in "Current state" §6).

**Verify**: `bun test apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts` → `1 pass`, `0 fail`, and the captured `stdout` still ends with `native cloud connection isolation/cancellation passed`.

### Step 2: Re-point the flow-unit test at the shared module

`apps/electron/src/main/__tests__/rox-connect-flow.test.ts` imports the shim
only. Change line 2 from `import { RoxConnectFlow } from '../rox-connect-flow'`
to `import { RoxConnectFlow } from '@rox/shared/auth'`. Change nothing else in
that file.

**Verify**: `bun test apps/electron/src/main/__tests__/rox-connect-flow.test.ts` → `5 pass`, `0 fail`.

### Step 3: Delete the dead copy and the shim

Only after step 1 passes against the server-core module:

- Delete `apps/electron/src/main/onboarding.ts`.
- Delete `apps/electron/src/main/rox-connect-flow.ts`.

**Verify**:
- `grep -rn "main/onboarding\|rox-connect-flow" --include=*.ts apps packages` returns no matches.
- `grep -rn "registerOnboardingHandlers" --include=*.ts packages apps` returns only the server-core definition, the server-core `index.ts` import + call, and the server-core test.
- `bun run typecheck:electron` → exit 0.
- Re-run `bun test apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts` → `1 pass`, `0 fail`.

### Step 4: Add the orphan guard

Create `packages/server-core/src/handlers/rpc/__tests__/onboarding-registration-orphans.test.ts`
with exactly this content:

```ts
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '../../../../../..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue
      out.push(...sourceFiles(full))
      continue
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

const DEFINITION = /export\s+(?:async\s+)?function\s+registerOnboardingHandlers\s*\(/

test('registerOnboardingHandlers is defined exactly once, in server-core', () => {
  const definers = [...sourceFiles(join(REPO_ROOT, 'apps')), ...sourceFiles(join(REPO_ROOT, 'packages'))]
    .filter(file => DEFINITION.test(readFileSync(file, 'utf8')))
    .map(file => relative(REPO_ROOT, file).split('\\').join('/'))
    .sort()
  expect(definers).toEqual(['packages/server-core/src/handlers/rpc/onboarding.ts'])
})

test('the server-core onboarding handler is wired into the production registration graph', () => {
  const index = readFileSync(join(REPO_ROOT, 'packages/server-core/src/handlers/rpc/index.ts'), 'utf8')
  expect(index).toContain("import { registerOnboardingHandlers } from './onboarding'")
  expect(index).toMatch(/registerOnboardingHandlers\(server,\s*deps\)/)
})
```

**Verify**: `bun test packages/server-core/src/handlers/rpc/__tests__/onboarding-registration-orphans.test.ts` → `2 pass`, `0 fail`.

### Step 5: Full gate

**Verify**:
- `bun run typecheck:electron` → exit 0.
- `bun run typecheck:shared` → exit 0.
- `bun test packages/server-core/src/handlers/rpc/__tests__/onboarding.test.ts` → `9 pass`, `0 fail` (the live handler is unchanged; this proves it).
- `git status --short` lists only the five in-scope files.

## Test plan

- **Migrated fixture** `apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts`
  (existing, one spawned-subprocess integration test). It keeps every current
  case: per-actor cloud isolation (a fresh actor must not see the host account),
  device start returns a user-facing link, `user.id` equals the approved device
  subject, no raw `accessToken` leaks through `GET_ROX_CLOUD_STATE`, balance
  `12.5`, logout isolation between actors, host credential store untouched,
  remote clients denied `START_ROX_CONNECT`/`CLEAR_ROX_CLOUD`, and a late
  approval after logout does not connect. Structural pattern for the harness
  wiring: `packages/server-core/src/handlers/rpc/__tests__/onboarding.test.ts:103-134`.
- **New guard** `packages/server-core/src/handlers/rpc/__tests__/onboarding-registration-orphans.test.ts`
  (2 tests) — fails if anyone re-adds a second `registerOnboardingHandlers`
  definition outside server-core, or unwires it from `index.ts`.
- **Re-pointed** `apps/electron/src/main/__tests__/rox-connect-flow.test.ts` —
  unchanged coverage of `RoxConnectFlow` attempt ownership, now against the
  shared module.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun test apps/electron/src/main/__tests__/native-rox-cloud-connect.test.ts` → `1 pass`, `0 fail`
- [ ] `bun test packages/server-core/src/handlers/rpc/__tests__/onboarding.test.ts` → `9 pass`, `0 fail`
- [ ] `bun test apps/electron/src/main/__tests__/rox-connect-flow.test.ts` → `5 pass`, `0 fail`
- [ ] `bun test packages/server-core/src/handlers/rpc/__tests__/onboarding-registration-orphans.test.ts` → `2 pass`, `0 fail`
- [ ] `bun run typecheck:electron` exits 0 and `bun run typecheck:shared` exits 0
- [ ] `apps/electron/src/main/onboarding.ts` and `apps/electron/src/main/rox-connect-flow.ts` no longer exist
- [ ] `grep -rn "registerOnboardingHandlers" --include=*.ts apps packages` matches only `packages/server-core/src/handlers/rpc/onboarding.ts`, `.../rpc/index.ts`, and server-core test files
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated (if that index exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows the in-scope files changed, and the live code no longer
  matches the "Current state" excerpts.
- A device-flow assertion genuinely cannot hold against the server-core
  handler after you have written stubs that satisfy
  `packages/shared/src/auth/rox-pocket-client.ts` — for example, the handler
  throws `ROX_OS_SECURE_STORAGE_UNAVAILABLE` even with
  `setRoxAccountAuthority` installed, or a channel the fixture invokes is not
  registered by `registerOnboardingHandlers`. Report the exact channel and error.
- The migration appears to require changing `packages/server-core/src/handlers/rpc/onboarding.ts`,
  an IPC channel name, or any file outside the in-scope list.
- Any `bun test` verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **You must not re-introduce a second onboarding registrar.** The guard test
  in step 4 exists precisely because the two copies diverged silently while a
  test stayed green on the dead one. If a future Electron-specific onboarding
  handler is genuinely needed, it must be registered from
  `apps/electron/src/main/handlers/index.ts:20` (`registerGuiRpcHandlers`) and
  the guard updated in the same change.
- **Reviewer should scrutinize**: that no channel was renamed (diff the two
  `HANDLED_CHANNELS` lists), that every behavioral assertion in the fixture was
  preserved (not dropped to make the port pass), and that the new stub speaks
  the `/api/auth/device/v2/*` + `/api/me/*` protocol rather than resurrecting
  the old `/device/start` one.
- **Deferred out of this plan**: nothing else consumes the shim
  `apps/electron/src/main/rox-connect-flow.ts`; the flow-unit test was
  re-pointed to `@rox/shared/auth` in step 2 rather than kept.