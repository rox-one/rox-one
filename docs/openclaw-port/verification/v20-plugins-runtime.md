# V20 — plugin subsystem runtime (descriptor scan · activation planner · hot reload · registry trust)

- Repo: `/Users/t/Projects/rox-w3-int` (worktree, branch `port/w3-int`)
- HEAD: `98e1e5cc4` (`git rev-parse --short HEAD`)
- Platform: darwin 27.0.0 arm64 · bun 1.4.2 · node v26.8.2
- Date: 2026-10-09
- Verdict: **PASS** for all four surfaces (rows f.7, c2.5, c2.6, c2.7) — with **one defect**
  found in the startup activation path (duplicate-id shadow), see §f.7 (D-1).

## Method

All evidence was produced by driving the **real** modules (the installed `node_modules`
were used as-is; no `bun install`, no source edits) from standalone bun processes under
`/tmp/v20/`. Every fixture package is a real directory on a real sandbox root under
`/tmp`; the activation/reload runs drive the real `ExtensionHostManager` over a real
in-process worker (`extension-host/worker.ts`) via the real message protocol; the
marketplace runs drive the real RPC handler `registerMarketplaceHandlers` with only a
minimal `{ handle, push }` server stub, the real installer, and the real signed bundled
catalog. A fetch spy wraps `globalThis.fetch` to count every network call.

```sh
cd /Users/t/Projects/rox-w3-int
bun /tmp/v20/part_a.ts          # (c2.5) descriptor scan
bun /tmp/v20/part_b.ts          # (f.7)  planner + real startup activation
bun /tmp/v20/part_c.ts          # (c2.6) hot reload
bun /tmp/v20/part_shadow.ts     # (f.7)  duplicate-id shadow probe
bun /tmp/v20/part_d.ts          # (c2.7) registry trust gate (real RPC + real install)
```

Scripts/state: `/tmp/v20/`. Raw transcripts: `/tmp/v20/runA-stdout.txt`,
`/tmp/v20/runB/part_b-transcript.txt`, `/tmp/v20/runC-transcript.txt`,
`/tmp/v20/runS-transcript.txt`, `/tmp/v20/runD-transcript.txt`.

---

## (c2.5) Descriptor scan — `extension-host/descriptors.ts`

Fixture sandbox (`configDir=/tmp/v20/runA/cfg`, extra root `/tmp/v20/runA/extraRoot`)
contains 8 packages: an unparsable manifest, a valid package, a package whose entry is a
symlink escaping the root, a valid non-craft runtime, an `onCommand:` package, an unknown
token package, a disabled-marked package, and a trailing valid package; plus a duplicate-id
package on the extra root.

### PASS — manifest-first scan reads manifests WITHOUT executing package code

Every fixture entry writes a marker file and sets `globalThis.__SCAN_EXECUTED` when
imported. After a full scan the markers directory is empty and the global is undefined:

```
-- no-execution proof --
marker files after scan     : []
globalThis.__SCAN_EXECUTED  : undefined
verdict                     : NO PACKAGE CODE RAN
```

The `descriptors` module never imports entry modules (only `readFileSync`/`createHash` —
no `import`/`require` of `entryPath`), so this is the expected result.

### PASS — escaping symlink rejected

`c-escape/manifest.json` declares `entry: "link.mjs"`; `link.mjs` is a symlink to
`/tmp/v20/runA/outside/evil.mjs` (outside both sandbox roots). `resolveEntryPath` realpaths
the candidate and re-checks containment → descriptor is `invalid`, no `entryPath`:

```
BAD  c-escape  issues=["entryPath-rejected: entryPath outside allowlisted sandbox roots"]
c-escape status/issues      : invalid ["entryPath-rejected: entryPath outside allowlisted sandbox roots"]
entryPath present           : undefined
verdict                     : REJECTED
```

### PASS — keeps scanning past an invalid package

`a-invalid` (unparsable JSON) sorts first; the trailing valid package `h-goodtail` (later in
the same root) is still scanned:

```
a-invalid                   : invalid ["manifest-unparsable"]
h-goodtail (after a-invalid): ok db9f395b02a1c82abc343ccb8534e21839c7bf20bddbd1cbf285d2d3948731d2
verdict                     : CONTINUED
```

### PASS — hashing is stable and matches an independent recompute

Two consecutive scans produce identical descriptor hashes, and each hash equals an
independent `sha256(manifestBytes + \0 + entryBytes + \0 + sortedFileList)` computed by the
probe from the same bytes:

```
hash identical across 2 scans: true
/b-good     recomputed=c93a7…2dcd6 observed=c93a7…2dcd6 match=true
/h-goodtail recomputed=db9f3…731d2 observed=db9f3…731d2 match=true
/e-defercmd recomputed=26c5a…6271  observed=26c5a…6271  match=true
```

(Note: entryPath in the transcript prints without its separator — `/privateb-good/...` —
because the realpath `/private/tmp/...` was relabelled against `/tmp/...` by the probe's
cosmetic string replace; the on-disk path is correct.)

---

## (f.7) Activation planner + startup — `extensions/activation.ts`, `extension-host/startup.ts`

The real descriptors above were fed to `planExtensionActivations` and then a real
`applyStartupActivations` run drove loads through an injected `ExtensionHostManager` backed
by the real worker (`setExtensionHostManagerForTests`).

Plan (`triggers=[startup]`), raw:

```
a-invalid       skip         descriptor-invalid
b-good          activate-now activation-all
c-escape        skip         descriptor-invalid
d-badruntime    skip         not-host-executable
e-defercmd      defer        defer:onCommand:hello.world
f-unknowntoken  skip         unknown-activation-event
g-disabled      skip         disabled
h-goodtail      activate-now activation-all
plannedLoads = ["b-good","h-goodtail"]
```

Real startup activation (`applyStartupActivations(trigger=startup)`):

```
activated = ["b-good","h-goodtail"]
failures  = []
pushed    = ["extensions:changed"]
loadedExtensions = ["b-good","h-goodtail"]
markers after startup = ["b-good","h-goodtail"]
callExtension(b-good, activate) = "b-good"
-- then trigger = {kind:'command', id:'hello.world'} --
activated = ["e-defercmd"]   loadedExtensions = ["b-good","h-goodtail","e-defercmd"]
```

| requirement | observed | verdict |
|---|---|---|
| `undefined` activationEvents → activate-now | `b-good activate-now activation-all` | PASS |
| `[]` activationEvents → activate-now | `h-goodtail activate-now activation-all` | PASS |
| `onCommand:<id>` → defer | `e-defercmd defer defer:onCommand:hello.world` | PASS |
| unknown token → skip | `f-unknowntoken skip unknown-activation-event` | PASS |
| non-craft-sandbox → skip | `d-badruntime skip not-host-executable` | PASS |
| disabled → skip, never loads | `g-disabled skip disabled`; absent from `loadedExtensions` and no marker | PASS |
| command trigger promotes the deferred row | `e-defercmd activate-now activation-event` | PASS |

### FAIL (D-1) — a duplicate-id shadow descriptor overrides the valid one in `applyStartupActivations`

When two sandbox roots contain packages with the same manifest `id`, `descriptors.ts`
documents "first wins, later one flagged `shadowed:<dir>`" and the planner correctly marks
the valid one `activate-now` and the shadow `skip`. But `applyStartupActivations` builds
`byId` **last-wins** over the id-sorted descriptor list, so the invalid shadow (sorted last)
replaces the valid descriptor and the extension is silently not loaded:

```
descriptor ok       id=dup dir=cfg/extensions/sandbox/dup
descriptor invalid  id=dup dir=extraRoot/aaa-shadow ["shadowed:/tmp/v20/runS/cfg/extensions/sandbox/dup"]
plan = ["dup:activate-now:activation-all","dup:skip:descriptor-invalid"]
activated = []              ← expected ["dup"]
loadedExtensions = undefined
markers = []
```

- Defect: `apps/electron/src/main/extension-host/startup.ts:122`
  `const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))`
  combined with the guard at `startup.ts:128` (`if (!descriptor?.entryPath || !descriptor.manifest) continue`).
- Smallest fix: only index valid descriptors, e.g.
  `const byId = new Map(descriptors.filter((d) => d.status === 'ok' && d.entryPath).map((d) => [d.id, d]))`
  — or do not overwrite an existing key while mapping.

---

## (c2.6) Hot reload — `ExtensionHostManager.reloadExtension`

Real in-process worker harness: `forkFn` returns a fake child wired to the **real** worker's
message loop; the worker's `importFn` records every import URL and re-reads the file bytes
each time (so an edit is genuinely re-imported, mirroring the ESM cache-bust).

### PASS — entry edit → `swapped` with a new import URL and v2 behaviour

```
before edit: version() = "v1"  importUrl = file:///…/swap-pack/index.mjs?rev=f393a3f1…890ae
outcome = {"status":"swapped","generation":1,"entryHash":"92975146…a65b57"}
after edit : version() = "v2"  importUrl = file:///…/swap-pack/index.mjs?rev=92975146…a65b57
url differs = true  | url2 has ?rev= = true
child load messages = 2
```

The new module is requested under a distinct `?rev=` URL and the live call returns `v2`.

### PASS — helper-file edit → `restartRequired` with ZERO load messages

```
messages before edit = 2  load/unload before = 2
outcome = {"status":"restartRequired","reason":"dependency-changed"}
messages after edit = 2  load/unload after = 2
load/unload messages emitted during reload = 0
still loaded on old revision = ["deps-pack"] version() = "v1"
```

The non-entry change is detected via the package fingerprint; no `load`/`unload` message is
sent and the extension stays on the old revision.

### PASS — unknown id → typed error

```
error name = ExtensionHostReloadError | instanceof = true | code = EXTENSION_NOT_LOADED
message = EXTENSION_NOT_LOADED: Extension not loaded: ghost
```

---

## (c2.7) Registry trust gate — `marketplace/trust.ts` + `server-core/…/rpc/marketplace.ts`

Both cases drive the real `RPC_CHANNELS.marketplace.INSTALL` handler; a `globalThis.fetch`
spy records every network call.

### PASS (a) — entry that cannot prove integrity → `REGISTRY_TRUST_BLOCKED` before any fetch, no lock write

An **unsigned** bundled catalog (custom assets root via `setBundledAssetsRoot`, no
`catalog.json.sig`) is the only catalog available; the remote catalog attempt is served
locally by the spy (no socket). `getCatalog` degrades to the bundled body with
`signatureVerified:false`, and the gate blocks on `catalog-signature-missing` before any
install work:

```
thrown instanceof CodedError = true | code = REGISTRY_TRUST_BLOCKED
message = Registry trust gate blocked this install: the catalog evidence is missing or unverified
fetch spy URLs = ["https://raw.githubusercontent.com/agisota/craft-agents-oss/main/apps/electron/resources/marketplace/catalog.json"]
install/clone (non-catalog) fetch URLs = []
lock file = /tmp/v20/runD/a/marketplace/lock.json | exists = false
```

The only spy URL is the catalog-sidecar fetch itself (served by the spy, zero sockets);
**zero** install/clone fetches fired and `lock.json` was never created.

### PASS (b) — clean signed+pinned entry → install proceeds, lock record carries the verdict

A fresh cache seeded verbatim from the **real bundled catalog** (`catalog.json` +
`catalog.json.sig`, ed25519 verified against the baked public key) short-circuits
`getCatalog` with `signatureVerified:true` and **zero** catalog fetches. Installing the
`portless` catalog entry passes the trust gate, runs the real installer + toolchain download
(real npm tarball), and returns `installed`; the lock record carries the verdict:

```
catalog fetch URLs before install = []
install result = {"id":"portless","kind":"tool","status":"installed","ref":"d42c741ac67d20a0b6e1f8f5b4192136de34fa03","toolName":"portless"}
progress/changed pushes = ["marketplace:CHANGED"]
fetch spy URLs total = ["https://registry.npmjs.org/portless/-/portless-0.15.5.tgz"]
lock record = {
  "id": "portless", "kind": "tool", "repo": "vercel-labs/portless",
  "ref": "d42c741ac67d20a0b6e1f8f5b4192136de34fa03",
  "status": "installed",
  "targets": ["/tmp/v20/runD/b/toolchain/portless/0.15.5"],
  "toolName": "portless",
  "trustVerdict": "clean", "trustReasons": [], "assessedAt": 1791561478812
}
trustVerdict = clean | trustReasons = []
```

`trustVerdict:"clean"` / `trustReasons:[]` are persisted on the lock record, and the tool
artifact was really downloaded and extracted under the isolated config dir.

---

## Unproven / not tested

- The activation/reload runs use the **in-process** worker harness (`startWorker`) connected
  through the real protocol, not an Electron `utilityProcess`; the utilityProcess fork path
  and the packaged `extension-host-worker.cjs` bundle were not exercised.
- `applyStartupActivations` was driven with `setExtensionHostManagerForTests`; the production
  singleton construction path (`getExtensionHostManager`) and workspace permission grant
  resolution (`resolveExtensionGrantsFromPermissions` against a real workspace) were not
  exercised — grants were empty in every run.
- Trust case (a) used a hand-built unsigned bundled catalog (no private signing key is in
  this checkout); the remote (network) unsigned-catalog path and the SiYuan/`local-folder`
  trust branches were not exercised.
- The D-1 shadow defect was reproduced only through `applyStartupActivations`; the same
  last-wins map pattern in other callers was not audited.
- No workspace-wide gate was run (`typecheck:all`, full `bun test`, `run-gates.sh`) — by
  charter.