# V16 — custodian playbooks in the real store (matrix c2.8 → system-agent playbooks)

Runtime verification against the REAL app-managed skill store on this machine (no
fixture store). Repo: `/Users/t/Projects/rox-one-port` @ `cfb1f1b8d` (main tip,
deps installed). bun 1.4.2, macOS `Darwin 27.0.0 arm64`. Verifier: `w2-verify-8`.
Date: 2026-10-09.

Targets: `apps/electron/resources/skills/rox-custodian/{add-model-provider,configure-channel,diagnose-gateway}/SKILL.md`,
`apps/electron/resources/skills/SKILLS.lock` (pack `rox-custodian`),
`apps/electron/resources/skills/REQUESTED-SKILLS.json` (entry `custodian skills /
system-agent playbooks`), `packages/shared/src/skills/` (eligibility/prompt/runtime).

## Surface driven (real processes / real sync / real store)

- **Store**: the application-owned tier `APP_MANAGED_SKILLS_DIR = join(resolveConfigDir(), 'skills')`
  (`packages/shared/src/skills/storage.ts:44`). Two instances were exercised:
  - **live**: `/Users/t/rox/skills` (the machine's actual store), and
  - **isolated**: `/tmp/v16-store/skills` via `ROX_CONFIG_DIR=/tmp/v16-store`
    (the v1-multiuser-runtime house style: an isolated real state dir produced by
    the real producer, so the credential toggle is deterministic and the live
    credential vault is not left mutated).
- **Producer**: the real startup sync `ensureBundledSkills({ bundleRoot:
  apps/electron/resources/skills, linksRoot: null })` (`bundled.ts:177`), which
  hash-merges the pinned bundle into the app-managed store.
- **Consumers**: the real eligibility pass `buildSkillEligibilityReport`
  (`eligibility.ts:371`), the real prompt-block builder `buildAvailableSkillsBlock`
  (`prompt.ts:63`) — the exact function the OMP spawn path calls
  (`omp-agent.ts:588-597`), and the real tool runtime `createNativeSkillsToolRuntime`
  (`skills-tool-runtime.ts:55`) behind `handleSkillsRead`/`handleSkillsSearch`
  (`session-tools-core`), registered via `registerSkillsToolRuntime`.
- Env gating resolves through the ROX credential fabric (`defaultEnvExists`,
  `eligibility.ts:139-148` → `CredentialManager.list()`), never `process.env`.
  The gate needs a credential whose type/scope maps to `OPENCLAW_GATEWAY_TOKEN`;
  the canonical one is `{ type: 'openclaw_gateway_token', runtimeId }`
  (`credentials/types.ts` `openClawGatewayCredentialId`).
- Harness scripts (scratch, `/tmp/v16/`): `sync.mjs`, `verify.mjs`, `verify2.mjs`,
  `envvar.mjs` (baked into verify2), `os.mjs`, `search.mjs`, `live2.mjs`.
  Commands were run as `bun /tmp/v16/<f>.mjs` with cwd = repo root; no repo files
  written except this report.

### Real store baseline (before any sync)

```
$ ls /Users/t/rox/skills | grep -cE 'add-model|configure-channel|diagnose-gateway'
0
$ stat -f "%Sm %N" /Users/t/rox/skills/.bundled/sync-stamp
2026-10-08 20:38  /Users/t/rox/skills/.bundled/sync-stamp
```

The `rox-custodian` pack ships in the bundle (`SKILLS.lock` `origin:"bundled"`,
`commit:"local"`, skills = the 3 slugs; `REQUESTED-SKILLS.json` entry present) but
was **not yet installed** in the live store: the shipped pack is dated 2026-10-09,
the store's sync stamp 2026-10-08. The real sync installs it:

```
$ bun /tmp/v16/live2.mjs      # ensureBundledSkills({ bundleRoot, linksRoot:null })
"store": "/Users/t/rox/skills",
"before": [],
"sync_ms": 137636,
"sync_custodian_pack": {
  "slug": "rox-custodian", "origin": "bundled", "commit": "local", "disabled": false,
  "localModified": false,
  "skills": ["add-model-provider","configure-channel","diagnose-gateway"],
  "installed": ["add-model-provider","configure-channel","diagnose-gateway"],
  "conflicts": [] }
```

Store after sync: `/Users/t/rox/skills` = 681 top-level entries (the 3 playbook
dirs are new regular directories; `.bundled/rox-custodian.json` records the pack
state). No `~/.agents/skills` links were touched (`linksRoot:null`).

---

## (a) the 3 playbooks parse — **PASS**

Loaded from the **live** store with the real flat discovery parser
(`loadSkillsFromDir(APP_MANAGED_SKILLS_DIR,'global')`, `storage.ts:220`):

```json
"parsed": [
 {"slug":"configure-channel",  "name":"configure-channel",  "requires":{"env":["OPENCLAW_GATEWAY_TOKEN"]},
  "src":"global","path":"/Users/t/rox/skills/configure-channel",  "bodyLen":4164},
 {"slug":"add-model-provider", "name":"add-model-provider", "requires":{"env":["OPENCLAW_GATEWAY_TOKEN"]},
  "src":"global","path":"/Users/t/rox/skills/add-model-provider", "bodyLen":4356},
 {"slug":"diagnose-gateway",   "name":"diagnose-gateway",   "requires":{"env":["OPENCLAW_GATEWAY_TOKEN"]},
  "os":["darwin","linux"], "src":"global","path":"/Users/t/rox/skills/diagnose-gateway","bodyLen":3220}
]
```

All three parse through `graymatter` + `parseSkillMachineMetadata`
(`storage.ts:89-129`): non-empty `name`/`description`, non-empty body, and the
`metadata.openclaw.requires.env` block folded into `metadata.requires.env`. The
isolated run is identical (`/tmp/v16-store/skills/*`, body lengths 4164/4356/3220).
Verdict: **PASS**.

## (b) eligible ONLY when `OPENCLAW_GATEWAY_TOKEN` is provisioned — **PASS**

Credential fabric empty (`cm.list()` = `[]`) → the scoped pass returns them
ineligible with a single reason each:

```json
"A_eligible": [],
"A_ineligible": ["add-model-provider:missing-env","configure-channel:missing-env","diagnose-gateway:missing-env"],
"A_block": null
```

After provisioning the credential (`cm.set(openClawGatewayCredentialId('v16gatewaytoken00000001'), {value:'…'})`):

```json
"creds_after": ["openclaw_gateway_token"],
"B_eligible": ["add-model-provider","configure-channel","diagnose-gateway"],
"read": { "add-model-provider": {"isError": false, ...}, ... }
```

The gate is `eligibility.ts:249-253` over `requires.env`, resolved by
`defaultEnvExists` (`eligibility.ts:139-148`) → `CredentialManager.list()` +
`credentialIdMatchesEnvName`. No other path admits them: with the credential
absent every one of the three carries `missing-env` and is neither eligible,
advertised (`A_block:null`) nor readable. Live-store run reproduces exactly the
same three states. Verdict: **PASS**.

### (b-nuance) a raw OS env var does NOT satisfy the gate — INFO / contract note

With `process.env.OPENCLAW_GATEWAY_TOKEN` set but **no** credential in the fabric:

```json
"rawEnv": {
 "varSet": true,
 "creds": [],
 "eligible": [],
 "ineligible": ["add-model-provider:missing-env","configure-channel:missing-env","diagnose-gateway:missing-env"]
}
```

`export OPENCLAW_GATEWAY_TOKEN=…` alone leaves the playbooks ineligible; only a
provisioned `openclaw_gateway_token` credential (or a scope/type alias matching
the name, `credentialIdMatchesEnvName`, `eligibility.ts:118-133`) admits them.
This matches the module's stated contract (“resolves through the ROX credential
fabric … never raw `process.env`”, `eligibility.ts:9-13`). If an operator expects
the literal shell variable to gate, that expectation is unmet. Smallest change to
honour the literal variable: in `defaultEnvExists` (`eligibility.ts:139`), also
return `true` when `process.env[env]` is a non-empty string.

## (c) `diagnose-gateway` additionally requires os = darwin | linux — **PASS**

Same credential-provisioned catalog, `platform` swept:

```json
{"darwin":{"eligible":["add-model-provider","configure-channel","diagnose-gateway"],"ineligible":[]},
 "linux": {"eligible":["add-model-provider","configure-channel","diagnose-gateway"],"ineligible":[]},
 "win32": {"eligible":["add-model-provider","configure-channel"],
           "ineligible":["diagnose-gateway:os-mismatch"]}}
```

The `os` field is parsed at `storage.ts:115` and enforced by `osMatches`
(`eligibility.ts:177-183`). On this darwin machine `diagnose-gateway` is admitted;
on `win32` it is rejected with `os-mismatch` while the other two stay eligible.
Verdict: **PASS**.

## (d) the advertised prompt block — **PASS (allowlisted form) / REFUTED (default full catalog)**

**(d1) allowlist-scoped session (production form, `omp-agent.ts:594` passes
`allowedSkillSlugs`).** With `allowedSlugs = the 3 slugs` and the credential
provisioned, the block lists exactly the three:

```
<available_skills>
Skills are installed but their instructions load only when you read one. Search
with `mcp__session__skills_search`, then load a skill with `mcp__session__skills_read` before following it.
## Global skills
- `add-model-provider` — Add and live-prove a model provider for the ROX-managed OpenClaw gateway with validated config writes, without exposing credentials. _(load: mcp__session__skills_read slug="add-model-provider")_
- `configure-channel` — Configure and prove a chat channel on the ROX-managed OpenClaw gateway with validated non-interactive writes; secrets only as SecretRefs. _(load: mcp__session__skills_read slug="configure-channel")_
- `diagnose-gateway` — Diagnose the ROX-managed OpenClaw gateway, con…
</available_skills>
```

With the credential absent the same call returns `buildAvailableSkillsBlock([])`
= `null` (no block). Identical output from the live store. Verdict **PASS**.

**(d2) default session (no allowlist → full catalog: `allowedSlugs:null`,
`includeOmp:true`, `includeCollisions:false`).** With the credential provisioned
the three ARE eligible, but the rendered block does **not** contain them:

```json
"full": { "caps": {"bytes": 8000, "entries": 64},
          "eligible_total": 1464,
          "block_bytes": 7890,
          "block_entry_lines": 31,
          "has_custodian": [],
          "last_line": "</available_skills>" }
```

Root cause: `buildAvailableSkillsBlock` emits groups in
`['project','workspace','global','omp']` order and stops at the 8000-byte / 64-entry
cap (`prompt.ts:30-32,93-120`); the `global` group is thousands of entries, so the
cap binds long before the custodian slugs (run under the concurrent verify pool —
31 of 1464 eligible lines fit). Truncation is signposted (`prompt.ts:124-127`) and
the omitted skills stay **discoverable through the tool**:

```
$ bun /tmp/v16/search.mjs
search isError false
custodian hits in search: [ "add-model-provider", "configure-channel", "diagnose-gateway" ]
## Skills search: "openclaw gateway"
3 skill(s)
1. **configure-channel** …
```

So the literal claim "the advertised prompt block lists them exactly when
eligible" is **REFUTED for the default (full-catalog) session** and **PASS for the
allowlisted session**. The block is a deliberately bounded sample; eligibility is
correct in both. Smallest fix if guaranteed advertisement is required: order
`metadata.always === true` skills first in `buildAvailableSkillsBlock`
(the field is parsed at `storage.ts:119` but currently inert — no consumer reads
it) and add `always: true` under `metadata.openclaw` in the three `SKILL.md`.

## (e) `skills_read` can read every advertised slug (advertised ⇒ readable) — **PASS**

Every slug the block advertised in (d1) was read back through the real handler
`handleSkillsRead({workspacePath:WS}, {slug})` against the real registered runtime:

```
add-model-provider | isError false | ## add-model-provider (add-model-provider) | _path: /Users/t/rox/skills/add-model-provider_
configure-channel  | isError false | ## configure-channel (configure-channel)  | _path: /Users/t/rox/skills/configure-channel_
diagnose-gateway   | isError false | ## diagnose-gateway (diagnose-gateway)    | _path: /Users/t/rox/skills/diagnose-gateway_
```

The isolated-store run returned the same verdict with `/tmp/v16-store/skills/…`
paths and non-empty bodies (4449 / 4254 / 3307 chars). `advertised ⊆ readable`
holds: the runtime catalog is rebuilt from the
same `buildSkillEligibilityReport` (`skills-tool-runtime.ts:55-62`) and these are
real directories inside the store (not escaping symlinks), so the
`isWithinRealRoot` confinement keeps them. Verdict: **PASS**.

## (f) no stale cache across the credential toggle — **PASS**

In one process, deleting the credential after (d1)/(e) immediately flips the pass
back, with no re-run of the sync and no cache invalidation needed:

```json
"C_creds": [],
"C_eligible": [],
"C_block": null
```

`handleSkillsRead` for `add-model-provider` then returns
`isError:true, [ERROR] SKILL_NOT_FOUND: no eligible skill "add-model-provider" in this workspace.`
The eligibility pass reads the credential fabric fresh per call (`defaultEnvExists`
→ `CredentialManager.list()`), so there is no stale eligibility/advertisement
cache. Verdict: **PASS**.

---

## Verdicts

| claim | verdict |
|---|---|
| (a) 3 playbooks parse from the real store with their gating metadata | **PASS** |
| (b) eligible ONLY when `OPENCLAW_GATEWAY_TOKEN` is provisioned | **PASS** |
| (b-nuance) a raw `process.env` var alone satisfies the gate | **FAIL** (credential-fabric only; see defect F2) |
| (c) `diagnose-gateway` additionally requires darwin\|linux | **PASS** |
| (d1) advertised block lists exactly the 3 in an allowlisted session | **PASS** |
| (d2) advertised block lists them in a default full-catalog session | **FAIL** (8000 B cap; see defect F1) |
| (e) advertised ⇒ readable via `skills_read` | **PASS** |
| (f) no stale cache after credential removal | **PASS** |

## Defects / findings

- **F1 (claim-level FAIL, low severity)** — an *eligible* gated playbook can be
  absent from the `<available_skills>` block when the session has no allowlist.
  Cause: the bounded block (`packages/shared/src/skills/prompt.ts:30-32` cap,
  `:93-120` emission, group order `prompt.ts:38`) fills the 8000-byte budget with
  the large `global` group before reaching the custodian slugs. Not a crash; the
  skills remain eligible, `skills_search`-findable, and readable. Smallest fix if
  guaranteed advertisement is required: emit `metadata.always === true` skills
  first in `buildAvailableSkillsBlock` and set `always: true` on the three
  playbooks (`storage.ts:119` already parses the field; nothing consumes it today).
- **F2 (contract nuance, INFO)** — eligibility never consults `process.env`;
  `OPENCLAW_GATEWAY_TOKEN` must exist as an `openclaw_gateway_token` credential in
  the ROX credential fabric (`packages/shared/src/skills/eligibility.ts:139-148`).
  Setting the shell variable alone leaves the playbooks hidden. Smallest change to
  honour the literal variable: also return `true` for a non-empty
  `process.env[env]` in `defaultEnvExists`.

## Unproven / not covered

- The block/read path was driven by calling the production builders and the
  registered tool runtime in-process (the exact code the OMP spawn / skills RPC
  layer runs), not through a live Electron + OMP spawn or a socket RPC; no
  `--append-system-prompt` payload was captured from a real child process.
- A true OpenClaw-gateway runtime was not provisioned, so the token used here is a
  synthetic `openclaw_gateway_token` credential (value never serialized); the
  playbooks' Gather→Mutate→Repair→Prove steps against a real gateway were not run.
- `includeOmp:true` full-catalog numbers vary with the machine-wide
  `~/.agents/skills` store and load; the (d2) omission held across the isolated
  and reasoning above but was not re-measured on the live store.

_Note:_ the live credential vault present at `/Users/t/rox` was empty before this
run (0 credentials); the empty `credentials.enc` / `credentials.enc.bak` the
manager materialized while toggling was removed afterwards, and the live store's
`rox-custodian` install (the real startup sync) was left in place.