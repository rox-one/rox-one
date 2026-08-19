# White-label knowledge engine (H1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking Знания in Rox opens a Craft-chrome notes workspace with a full block editor (slash, highlights, in-note databases), recursive notebook/folder/note/DB tree, and a pinned OEM kernel process — without SiYuan branding or a second installer.

**Architecture:** Keep HTTP `KnowledgeProvider` + `WebContentsView` embedding. Add `SiyuanProcessManager` that spawns a pinned loopback kernel (port not 6806) once G2/C is ACCEPTED. Rox draws the navigator; the OEM fork supplies integrated-mode editor. Agent writes stay on proposals. OEM kernel sources live in a private repo — this plan only consumes a pin manifest + binary path.

**Tech Stack:** Bun, Electron main, existing `siyuan-bootstrap.ts` / `SiyuanKernelClient` / `KnowledgeNotebookTree`, jotai, bun:test.

## Global Constraints

- Apache tree (`rox-one/rox-one`) must not contain SiYuan/OEM kernel source or unpacked UI assets. Pin metadata (version, sha256, relative payload path) is allowed.
- Until `docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md` is `Status: ACCEPTED` with variant C, `mode: 'managed'` that ships/downloads a kernel stays fail-closed (`CAPABILITY_DISABLED` / `engineStatus.running: false` with reason citing G2). Process-manager unit tests may use a fake executable.
- User-visible host copy: "Знания", "ядро знаний", product "Rox". No "SiYuan" in production UI strings (10-locale parity via `lint:i18n:parity`).
- Human typing in the editor writes the kernel live. Agent mutations only via `proposeMutation` / existing P3 channels.
- Renderer never HTTP-calls the kernel; tokens only in main / server-core via `CredentialManager`.
- Default locale of the fork is `ru`; this repo still ships 10 locales for host chrome.
- Tests: `bun test <file>`. Do not run full `bun test` or formatters unless a task says so.
- H3 in-process merge is out of this plan. Do not delete `plans/next-program/decisions/002-h3-in-process-knowledge-kernel.md`.

**Split:** OEM fork (W2 chrome strip, theme tokens, integrated URL) is a second codebase. Tasks 1-10 are this monorepo. Task 11 is a contract the fork must satisfy before pin bump. Remote TLS guard is Task 10.

---

## File map

| File | Responsibility |
|---|---|
| `packages/shared/src/knowledge/oem-pin.ts` | Parse/validate `oem-kernel-pin.json`. |
| `apps/electron/resources/oem-kernel-pin.json` | Pin record only (no binary in git). |
| `packages/server-core/src/knowledge/process-manager.ts` | Spawn/supervise/kill pinned kernel. |
| `packages/server-core/src/knowledge/siyuan-bootstrap.ts` | BYO path; delegate managed when G2 allows. |
| `packages/core/src/knowledge/providers/siyuan/client.ts` | `listDocTree` plus av list. |
| `packages/server-core/src/handlers/rpc/knowledge.ts` | `knowledge:listTree`, user-direct create. |
| `apps/electron/src/renderer/knowledge/knowledge-tree.ts` | Pure tree + filter. |
| `apps/electron/src/renderer/knowledge/KnowledgeNotebookTree.tsx` | Recursive UI. |
| `apps/electron/src/renderer/knowledge/KnowledgeNavigator.tsx` | Remove full-SiYuan CTA. |
| `apps/electron/src/renderer/knowledge/siyuan-url.ts` | Integrated-mode query. |
| `apps/electron/src/renderer/knowledge/KnowledgeHome.tsx` | Default last note / editor. |

---

### Task 1: OEM pin manifest (no binary)

**Files:**
- Create: `packages/shared/src/knowledge/oem-pin.ts`
- Create: `packages/shared/src/knowledge/__tests__/oem-pin.test.ts`
- Create: `apps/electron/resources/oem-kernel-pin.json`

**Interfaces:**
- Produces:

```ts
export interface OemKernelPin {
  version: string
  sha256: Record<'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'win32-x64', string>
  relativePayloadDir: string
  minApi: string
  maxApiExclusive: string
}
export function parseOemKernelPin(raw: unknown): OemKernelPin
export function pinPlatformKey(platform: NodeJS.Platform, arch: string): keyof OemKernelPin['sha256']
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test'
import { parseOemKernelPin, pinPlatformKey } from '../oem-pin'

describe('parseOemKernelPin', () => {
  it('accepts a complete pin', () => {
    const pin = parseOemKernelPin({
      version: '3.1.28-rox.1',
      sha256: {
        'darwin-arm64': 'a'.repeat(64),
        'darwin-x64': 'b'.repeat(64),
        'linux-x64': 'c'.repeat(64),
        'win32-x64': 'd'.repeat(64),
      },
      relativePayloadDir: 'resources/oem-kernel',
      minApi: '3.0.0',
      maxApiExclusive: '4.0.0',
    })
    expect(pin.version).toBe('3.1.28-rox.1')
    expect(pinPlatformKey('darwin', 'arm64')).toBe('darwin-arm64')
  })

  it('rejects missing sha256 platform', () => {
    expect(() =>
      parseOemKernelPin({
        version: '1',
        sha256: {},
        relativePayloadDir: 'x',
        minApi: '3',
        maxApiExclusive: '4',
      }),
    ).toThrow(/sha256/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/src/knowledge/__tests__/oem-pin.test.ts`

Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Validate object keys, sha256 hex length 64, non-empty version. Map `darwin`+`arm64` to `darwin-arm64`, `darwin`+`x64` to `darwin-x64`, `linux`+`x64` to `linux-x64`, `win32`+`x64` to `win32-x64`; throw on others.

Seed `apps/electron/resources/oem-kernel-pin.json` with placeholder hashes of 64 zeros. Do not add a binary.

- [ ] **Step 4: Re-run tests**

Run: `bun test packages/shared/src/knowledge/__tests__/oem-pin.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/knowledge/oem-pin.ts packages/shared/src/knowledge/__tests__/oem-pin.test.ts apps/electron/resources/oem-kernel-pin.json
git commit -m "feat(knowledge): OEM kernel pin manifest without binary payload"
```

---

### Task 2: Process manager state machine (fake binary)

**Files:**
- Create: `packages/server-core/src/knowledge/process-manager.ts`
- Create: `packages/server-core/src/knowledge/__tests__/process-manager.test.ts`

**Interfaces:**
- Consumes: `OemKernelPin` from Task 1
- Produces:

```ts
export type ManagedKernelError =
  | 'G2_BLOCKED'
  | 'PIN_MISSING'
  | 'BINARY_MISSING'
  | 'PORT_CONFLICT'
  | 'KERNEL_CRASHED'
  | 'WORKSPACE_LOCKED'
  | 'TIMEOUT'

export interface ManagedStartInput {
  configDir: string
  connectionId: string
  g2AcceptedVariant: 'C' | null
  pin: OemKernelPin
  resolveBinary: (pin: OemKernelPin) => string | null
  spawnFn: (
    cmd: string,
    args: string[],
    opts: { cwd?: string },
  ) => {
    pid: number
    unref(): void
    on(ev: 'exit', cb: (code: number | null) => void): void
    kill(sig?: string): void
  }
  allocatePort: () => number
  now?: () => number
}

export interface ManagedInstance {
  pid: number
  port: number
  baseUrl: string
  workspacePath: string
  accessAuthCode: string
}

export class SiyuanProcessManager {
  async start(input: ManagedStartInput): Promise<ManagedInstance>
  async stop(opts?: { graceMs?: number }): Promise<void>
  status(): { running: boolean; pid?: number; port?: number; error?: ManagedKernelError }
}
```

Workspace path must be `join(configDir, 'knowledge-workspaces', connectionId)`.

Launch args (verify at pin time): `--workspace=`, `--port=`, `--accessAuthCode=`, `--lang=ru`. Port from `allocatePort()` must not be 6806.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'bun:test'
import { parseOemKernelPin } from '@craft-agent/shared/knowledge/oem-pin'
import { SiyuanProcessManager } from '../process-manager'

const pin = parseOemKernelPin({
  version: '3.1.28-rox.1',
  sha256: {
    'darwin-arm64': 'a'.repeat(64),
    'darwin-x64': 'b'.repeat(64),
    'linux-x64': 'c'.repeat(64),
    'win32-x64': 'd'.repeat(64),
  },
  relativePayloadDir: 'resources/oem-kernel',
  minApi: '3.0.0',
  maxApiExclusive: '4.0.0',
})

describe('SiyuanProcessManager', () => {
  it('fails closed when G2 is not C', async () => {
    const pm = new SiyuanProcessManager()
    await expect(
      pm.start({
        configDir: '/tmp/cfg',
        connectionId: 'c1',
        g2AcceptedVariant: null,
        pin,
        resolveBinary: () => '/bin/true',
        spawnFn: () => {
          throw new Error('should not spawn')
        },
        allocatePort: () => 19200,
      }),
    ).rejects.toMatchObject({ code: 'G2_BLOCKED' })
    expect(pm.status().running).toBe(false)
  })

  it('spawns on ephemeral port with G2=C', async () => {
    const kids: Array<{ pid: number; killed?: string }> = []
    const pm = new SiyuanProcessManager()
    const inst = await pm.start({
      configDir: '/tmp/cfg',
      connectionId: 'c1',
      g2AcceptedVariant: 'C',
      pin,
      resolveBinary: () => '/fake/kernel',
      allocatePort: () => 19201,
      spawnFn: (cmd, args) => {
        expect(cmd).toBe('/fake/kernel')
        expect(args.some((a) => a.includes('19201'))).toBe(true)
        expect(args.some((a) => a.includes('6806'))).toBe(false)
        return {
          pid: 4242,
          unref() {},
          on() {},
          kill(sig?: string) {
            kids.push({ pid: 4242, killed: sig })
          },
        }
      },
    })
    expect(inst.port).toBe(19201)
    expect(inst.baseUrl).toBe('http://127.0.0.1:19201')
    expect(inst.workspacePath).toContain('knowledge-workspaces/c1')
    await pm.stop({ graceMs: 0 })
    expect(kids[0]?.killed).toBe('SIGTERM')
  })
})
```

Add a third test that records the `on('exit')` callback, fires it 5 times with code 1, and asserts `status().error === 'KERNEL_CRASHED'`.

- [ ] **Step 2: Run — expect FAIL**

`bun test packages/server-core/src/knowledge/__tests__/process-manager.test.ts`

- [ ] **Step 3: Implement `SiyuanProcessManager`**

Throw with `code: 'G2_BLOCKED'` if `g2AcceptedVariant !== 'C'`. Generate `accessAuthCode` via `crypto.randomBytes(16).toString('hex')`. After 5 exits, set `KERNEL_CRASHED` and do not spawn again until `stop()`. `stop`: SIGTERM then SIGKILL after `graceMs` (0 in tests).

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/server-core/src/knowledge/process-manager.ts packages/server-core/src/knowledge/__tests__/process-manager.test.ts
git commit -m "feat(knowledge): managed kernel process manager fail-closed on G2"
```

---

### Task 3: Read G2 record + wire ENGINE_START managed path

**Files:**
- Create: `packages/server-core/src/knowledge/g2-status.ts`
- Create: `packages/server-core/src/knowledge/__tests__/g2-status.test.ts`
- Modify: `packages/server-core/src/knowledge/siyuan-bootstrap.ts`
- Modify: `packages/server-core/src/handlers/rpc/knowledge.ts`
- Modify: `packages/shared/src/protocol/dto.ts` (`KnowledgeEngineStatus.reason?: string`)

**Interfaces:**

```ts
export function readG2AcceptedVariant(markdown: string): 'C' | 'B' | null
```

Parse `g2-decision-record.md`: ACCEPTED plus variant C yields `'C'`; otherwise `null`. Path override: `G2_RECORD_PATH`.

When variant is C and `resolveBinary(pin)` returns a path, `ensureLocalKernel` calls `SiyuanProcessManager.start` and writes connection `mode: 'managed'`, `baseUrl: inst.baseUrl`. Store `accessAuthCode` with the same credential key format `ensureDefaultLocalConnection` already uses (`source_bearer::workspaceId::siyuan-local`). Do not add a new CredentialType.

When G2 is not C, ENGINE_START keeps detect/open-app (user binary). Never download.

- [ ] **Step 1: Test `readG2AcceptedVariant`**

```ts
expect(readG2AcceptedVariant('# G2\n> **Status: ACCEPTED**\nvariant C')).toBe('C')
expect(readG2AcceptedVariant('**Status: OPEN**')).toBe(null)
```

- [ ] **Step 2-4:** implement; run `bun test packages/server-core/src/knowledge/__tests__/g2-status.test.ts` and existing `siyuan-bootstrap.test.ts`

- [ ] **Step 5: Commit** `feat(knowledge): honor G2 C for managed ENGINE_START`

---

### Task 4: Kernel client list tree + databases

**Files:**
- Modify: `packages/core/src/knowledge/providers/siyuan/client.ts`
- Create: `packages/core/src/knowledge/providers/siyuan/__tests__/client-tree.test.ts`

**Interfaces:**

```ts
export interface SiyuanDocTreeNode {
  id: string
  name: string
  path: string
  kind: 'document' | 'folder' | 'database'
  children?: SiyuanDocTreeNode[]
}

export interface ListDocTreeResult {
  notebookId: string
  nodes: SiyuanDocTreeNode[]
}
```

Use `POST /api/filetree/listDocsByPath` with `{ notebook, path: '/' }`. Databases: SELECT-only SQL via existing `querySql` + `assertSelectOnly` (`type='av'`). Do not wrap delete/remove.

- [ ] **Step 1:** mock `post`; assert folders+docs; second test merges av rows as `kind: 'database'`

- [ ] **Step 2-4:** implement + `bun test` that file

- [ ] **Step 5: Commit** `feat(knowledge): list notebook doc tree including databases`

---

### Task 5: RPC listTree + user-direct create

**Files:**
- Modify: `packages/shared/src/protocol/channels.ts` — `LIST_TREE: 'knowledge:listTree'`, `USER_CREATE: 'knowledge:userCreate'`
- Modify: `packages/shared/src/protocol/routing.ts` and `__tests__/routing.test.ts`
- Modify: `packages/server-core/src/handlers/rpc/knowledge.ts` and its test

**Produces:**

```ts
userCreate({ connectionId, source: 'navigator', op: 'notebook', name: string }): Promise<{ id: string }>
userCreate({ connectionId, source: 'navigator', op: 'folder', notebookId, path, name }): Promise<{ path: string }>
userCreate({ connectionId, source: 'navigator', op: 'document', notebookId, path, title }): Promise<{ id: string }>
```

If `source === 'agent'`, reject `UNSUPPORTED_OPERATION` (agents use propose). LIST_TREE is REMOTE_ELIGIBLE. USER_CREATE follows adjacent knowledge write routing.

If kernel has no public create-av, create a document via `createDocWithMd` and do not fake `kind: 'database'` until av API is confirmed.

- [ ] **Step 1-4:** routing tests then handler tests with mocked client

- [ ] **Step 5: Commit** `feat(knowledge): listTree and user-direct create ops`

---

### Task 6: Pure navigator tree + filters

**Files:**
- Create: `apps/electron/src/renderer/knowledge/knowledge-tree.ts`
- Create: `apps/electron/src/renderer/knowledge/__tests__/knowledge-tree.test.ts`

**Produces:**

```ts
export type NavFilter = 'all' | 'notes' | 'databases'
export function filterTree(nodes: SiyuanDocTreeNode[], filter: NavFilter): SiyuanDocTreeNode[]
export function collectDatabases(nodes: SiyuanDocTreeNode[]): SiyuanDocTreeNode[]
```

- `all`: keep folders that still have children after filter
- `notes`: drop `kind === 'database'`
- `databases`: only database nodes, keep folder parents that contain DBs

- [ ] **Step 1-5:** TDD then commit `feat(knowledge): navigator tree filter all/notes/databases`

---

### Task 7: Recursive KnowledgeNotebookTree + create menu

**Files:**
- Modify: `apps/electron/src/renderer/knowledge/KnowledgeNotebookTree.tsx`

Load notebooks; expanding one calls `listTree`. Recursive rows. Filter chips: i18n `knowledge.nav.filterAll|Notes|Databases`. `+` menu calls `userCreate`. Document click: `routes.view.siyuan({ kind: 'document', id })`. Database click: `{ kind: 'database', id }`. Keep inbox/daily/tags hidden when empty.

- [ ] Implement + route-helper tests

- [ ] Commit `feat(knowledge): recursive notebook tree in navigator`

---

### Task 8: Strip SiYuan chrome leaks + default editor

**Files:**
- Modify: `KnowledgeNavigator.tsx` — production: no `openFullInterface`. Dev-only if `import.meta.env.DEV` or `CRAFT_DEBUG_KNOWLEDGE_FULL_UI`.
- Modify: `siyuan-url.ts` — append `craftIntegrated=1`.
- Modify: `KnowledgeHome.tsx` — offline copy without vendor name. Healthy kernel with no search: navigate to last envelope document or empty editor.
- Modify: 10 locale files under `packages/shared/src/i18n/locales/` — no `SiYuan` in `knowledge.*` user strings.
- Modify: `apps/electron/src/renderer/actions/` — Cmd+N in knowledge mode creates a document in the last notebook.

- [ ] Tests: `isSiyuanCompatRef` still true for `__full__`; navigator production path does not render the button.

- [ ] Run i18n parity script if present in `package.json`

- [ ] Commit `fix(knowledge): Craft-only chrome and default editor on Knowledge`

---

### Task 9: Isolated partition for embedded editor

**Files:**
- Modify: `apps/electron/src/main/browser-pane-manager.ts` if needed — optional `partition?: string` on `createEmbeddedInstance`, default current persist name.
- Modify: `apps/electron/src/main/handlers/siyuan.ts` — pass `persist:knowledge-engine`.
- Modify: `apps/electron/src/main/handlers/__tests__/siyuan.test.ts`

- [ ] Commit `feat(knowledge): isolated Electron partition for editor surface`

---

### Task 10: Remote connection TLS guard

**Files:**
- Modify: `packages/shared/src/protocol/dto.ts` — `mode: 'external-local' | 'managed' | 'remote'`
- Modify: knowledge connections store `put` — remote `baseUrl` must be `https:` or loopback `http://127.0.0.1` / `http://localhost`; else `TLS_REQUIRED`

- [ ] Tests on store

- [ ] Commit `feat(knowledge): remote connection TLS guard`

---

### Task 11: OEM fork contract (other repo)

**Files:**
- Create: `docs/superpowers/specs/2026-08-20-oem-kernel-pin-contract.md`

Fork must ship for pin `3.1.28-rox.1`:

1. `craftIntegrated=1` hides app shell, Documents, bazaar, AI, about.
2. Default locale `ru`.
3. CSS variables mapped to Rox tokens (`--b3-theme-background` to host `--background`, surface to `--muted`, font ~13px).
4. Plugin ABI unchanged; bazaar URL from `rox.catalogUrl`.
5. HTTP API compatible with `SiyuanKernelClient`.
6. Launch flags as Task 2.
7. Per-platform tarball sha256 in `oem-kernel-pin.json`; tarball not committed here.

- [ ] Commit `docs: OEM kernel pin contract for W2 fork`

---

### Task 12: Plugin catalog allowlist

**Files:**
- Create: `packages/shared/src/knowledge/plugin-allowlist.ts`
- Create: `packages/shared/src/knowledge/__tests__/plugin-allowlist.test.ts`

```ts
export const OEM_PLUGIN_ALLOWLIST: string[] = []
export function filterBazaarPackages<T extends { name: string }>(packages: T[]): T[]
```

Empty allowlist => no marketplace installs. Never install names outside the list.

- [ ] Commit `feat(knowledge): OEM plugin allowlist filter`

---

## Self-review

| Spec section | Task |
|---|---|
| Pin / dual repo / no sources | 1, 11 |
| Managed spawn, port, workspace, G2 | 2, 3 |
| HTTP contract | 4, 5 |
| Navigator IA | 6, 7 |
| Craft chrome, default editor | 8, 9 |
| Remote TLS | 10 |
| E1 plugins | 12 |
| H3 leftover | `002-h3-in-process-knowledge-kernel.md` — no code |
| Human live vs agent proposals | 5 rejects `source: 'agent'` |

No TBD placeholders. Names `ManagedInstance`, `SiyuanDocTreeNode`, `NavFilter` are consistent across tasks.
