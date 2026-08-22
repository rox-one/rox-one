# DO IT ALL — defect / gap inventory

- **Date:** 2026-08-13
- **Owner instructions:** `DO IT ALL`; exact `АПPLY HMA-20260809-A1` received 2026-08-19; branding charter separately signed.
- **Worktree:** `/Users/marklindgreen/Projects/_craft_worktrees/do-it-all-security-slices` (`do-it-all/security-slices` @ `99cd5ea9e`), uncommitted
- **Recovery:** `/tmp/craft-agents-do-it-all` was deleted; ungated B sources reconstructed onto this durable worktree and re-verified
- **Primary checkout:** `/Users/marklindgreen/Projects/craft-agents` on `fix/sessions-fr38-fr47` (dirty, ahead 2 / behind 6) — **not used for implementation**
- **Live A0 snapshot:** `2026-08-19T09:48:50Z` (modes/counts only; no secrets)

Skills (slash aliases are unavailable):

1. `~/.agents/skills.shared-archive/spec-driven-workflow/SKILL.md`
2. `~/.agents/skills/planning-and-task-breakdown/SKILL.md`
3. `~/.agents/vendor/mattpocock-skills/skills/engineering/improve-codebase-architecture/SKILL.md`

---

## How to structure remaining work

One writer per session. Spec before code. Isolated worktree. Narrow vertical slice. Never mix Hermes mutation with product code.

Do **not** run A+B+C as one mutation wave. This wave implemented B (+ local session-intelligence catalog) and recorded A/C as fail-closed.

Verification: focused `bun test` on touched files. No project-wide suite, no commit unless asked.

---

## A — Hermes / OMP / Tailscale ops

| ID | Finding | Sev | Evidence | Owner | Gate |
|---|---|---|---|---|---|
| A-P0 | `approvals.mode=off` | P0 | `hermes config get approvals.mode` @ 12:32:55Z | infra | APPLY then A2 |
| A-TIR | Tirith enabled, **fail-open** | P0 | `security.tirith_fail_open=true` | infra | APPLY then A2 |
| A-URL | `allow_private_urls=true` | P1 | hermes config | infra | A2 |
| A-SKL | `skills.write_approval=false`, `memory.write_approval=false` | P1 | hermes config | infra | A2 |
| A-644 | `~/.hermes/.env.backup*` mode **644** | P1 | `stat -f '%Lp'` (modes only) | infra | A3 |
| A-TSK | `tskey-api.secret` **MISSING** (was 600 at 13:33Z) | info | `stat` / exists | infra | do not search contents; rotate if the key was live |
| A-GW | Gateway launchd stale | P2 | `hermes gateway status` | infra | after A2 |
| A-CRON | cron list JSON not valid this probe (exit 2 usage); prior 3/18 error class | P2 | `hermes cron list --json` | infra | not Stage C |
| A-ST | Syncthing CLI missing | P2 | `command -v syncthing` | infra | do not start speculatively |
| A-TS | Tailscale Running, 600 peers, **target unresolved** | P0 for migrate | `tailscale status --json` counts only | infra | named source/target |
| A-GIT | Hermes v0.20.0 in sync with origin/main (`c0106e50`) | P3 | `hermes version`; origin/main `c0106e50` | infra | after A3 |
| A-OMP | Default already `cursor/cursor-grok-4.6-xhigh` | done | `~/.omp/agent/config.yml` | pzd | new sessions only |
| A-LOG | Apply initialization failed closed | P0 | owner-only apply root; `INIT audit-checksums FAIL`; 15/22 mismatch; no tools copied/A0 commands run | infra | revision-3 remediation approval |

### Next steps (A)

1. Do not retry Stage C or re-checksum current bytes. Review/fix revision-3 audit docs/tools, then obtain an exact new revision-3 owner approval.
2. After revision-3 checksum/A0 passes: `APPROVE A1 BACKUP` — age-encrypt backups; **never** restore `approvals.mode=off`.
3. `APPROVE A2 HERMES SMART` — `approvals.mode=smart`; Tirith fail-closed; private URL policy.
4. `APPROVE A3 PERMISSIONS` — chmod env backups; do not bundle Tailscale key rotation.
5. Name Tailscale source and target nodes before any ACL/Syncthing apply.
6. Fix cron billing/GCS as a separate class (not Stage C).
7. Start new OMP sessions to pick up Grok xhigh (existing sessions keep start model).

**Stop:** apply evidence exists but A0 did not start. No retry, `hermes config set`, backup, chmod, Funnel, yolo, ACL, messaging, or Syncthing until revision-3 and later exact gates.

---

## B — craft-agents product security

| ID | Finding | Sev | Evidence | Status this wave |
|---|---|---|---|---|
| B-MIG | `knowledge:migrateNotes` was `REMOTE_ELIGIBLE` while handler is local vault/kernel | P0 | `packages/shared/src/protocol/routing.ts` | **LOCAL_ONLY** + test |
| B-ROOT | `CONFIG_DIR` eager import-time snapshot; notes roots unchecked vs secrets | P0 | `packages/shared/src/config/paths.ts` | lazy `getConfigDir()` + `OwnedRootPolicy`; eager export kept |
| B-ABS | Import paths must be absolute | P1 | spec FR-7 | `assertNotesImportPaths` wired into `resolveWorkspaceNotesRoot` (FR-5) and `migrateCraftNotesToSiyuan`; `listNotesForMigration`/`migrateCraftNotesToSiyuan` reject relative + credentials.enc (AC-4) + identity.json (EC-3) |
| B-CF2 | Corrupt `credentials.enc` was `unlinkSync`'d | P0 | `secure-storage.ts` `handleCorruptedFile` | quarantine dir `0700`, file `0600`; injected `filePath` |
| B-ID | Raw secret crossed `identity.connect` | P1 | approved CF-4 spec; `identity.ts`; local-only routing; trusted renderer binding | **closed** — dedicated `identity:storeCredential`; connect/core store carry only `credentialRef` |
| B-VAL | `StoredCredential.value` is still the live secret field | P1 | `credentials/types.ts` | expected until CF-4 broker |
| B-CF1 | Envelope/registry still **absent** on HEAD `99cd5ea9e`; unauthorized untracked `envelope.ts` removed this wave | P2 | no `envelope.ts` / `envelope.test.ts` in worktree | do not re-implement |
| B-G0 | Gate 0 worksheet present; facts still missing (DeviceRecord, WebAuthn, origins, microVM digest, issuer) | P0 | `docs/security/external-access-deployment-contract.md` | worksheet present; facts still **BLOCKED**/MISSING (not filled) |
| B-ALL | Session default `permissionMode=allow-all` | P1 | `apps/electron/resources/config-defaults.json:19` | owner decision; not flipped |
| B-SRC | Generic Sources FTS / prompt ingress (architecture candidate 3) | P1 | evidence memo; not fully on this commit | parked |
| B-SI | Personal Session Intelligence had no consent-first local catalog | P1 | design `2026-08-13-personal-session-intelligence-*.md` | W1–W5.2 local: registry, adapters, RPC, Memory panel mounts `SessionIntelligencePanel` at `MemoryListPanel.tsx:670` with candidate inbox. Extraction is deterministic/bounded; rank/confirm/correct/hide/delete; **no** prompt injection (W6), **no** network sync |

### Next steps (B)

1. Keep `MIGRATE_NOTES` as a channel; do not delete RPC; do not ship Notes Imports UI.
2. Do not rewrite every `CONFIG_DIR` importer; new code uses `getConfigDir()`.
3. CF-4 plus approved Amendment A1 are complete; CF-3 broker/lease remains a separate future decision.
4. Owner fills Gate 0 worksheet (datastore, microVM digest, `APP_ORIGIN`/`SHARE_ORIGIN`) before external-access increments C–F.
5. Review `permissionMode=allow-all` as a product decision; do not silently change default.
6. Session intelligence W6 promotion / prompt injection — **blocked** until retention policy.
7. W7 remote analysis / W8 Iroh sync — **blocked** until pairing + redaction review.
8. Rebase this worktree onto a clean line before merging; do not commit into the dirty `fix/sessions-fr38-fr47` tree.
9. W5.2 candidate review landed this wave; W6 promotion still blocked on retention policy.

### CF-4 evidence (2026-08-19)

- Owner gates: exact `APPROVE CF-4 IDENTITY CREDENTIAL INTAKE` and `APPROVE CF-4 AMENDMENT A1`; implementation stayed inside the reviewed allowlists and remains uncommitted.
- Contract: `STORE_CREDENTIAL` is `LOCAL_ONLY` and absent from `REMOTE_ELIGIBLE_CHANNELS`; the explicit 568-channel IPC inventory includes `identity:storeCredential`; renderer handshake and canonical `SWITCH_WORKSPACE` update/verify `WindowManager` before RPC client context; replayed `identity.connect.credentialValue` fails closed.
- Data flow: intake stores the trimmed fake/real token only through `CredentialManager`; `IdentityStore` accepts only the non-secret `credentialRef`; CF-1 `envelope.ts` remains absent.
- Verification: focused CF-4 **70 pass / 0 fail**; focused A1 **16 pass / 0 fail**; B-security + CF-4 + A1 union **225 pass / 0 fail**, **5655 expectations**, across 21 files; shared/core/server-core/Electron typechecks all pass; immutable pre/post manifest `7fa88067031e729e6f94586d7abd5957859d5598afd7a902dd53b74573421e3e`.
- Native smoke: current Electron artifacts launched with an isolated temporary config; fake token `cf4-not-a-real-secret` produced `CF4 smoke · connected`, then the secret field/form disappeared from the accessibility surface. Process and temporary config were removed; no SiYuan kernel process remained.
- Build caveat outside CF-4: `bun run start` is blocked before launch by pre-existing unrelated lint errors; manual current-artifact build succeeded through renderer/copy, while the repository's `build:validate` script points to a missing `scripts/validate-assets.ts`.

**Stop:** no SiYuan `mode: managed`; no SQLite-over-network; no Funnel. Do not re-implement CF-1 `envelope.ts`. Do not inject candidates into prompts.

---

## C — product identity, Git, maturity

| ID | Finding | Sev | Evidence | Next |
|---|---|---|---|---|
| A-OPS-DOC | A-ops staged runbook written; no Hermes mutation | P0 | `docs/security/2026-08-19-a-ops-runbook.md` | document only; APPLY still required |
| B-CF4 | Dedicated local-only credential intake + A1 workspace trust | P1 | approved specs + plan + 225-test union gate | implemented, independently reviewed, and native-smoked; uncommitted |
| C-BRAND-PLAN | README/clone plan written; README untouched | P2 | `docs/product/2026-08-19-branding-readme-plan.md` | unsigned |
| C-NAME | Names diverge: Craft Agents, `craft-agent` 0.11.4, `agents.craft.do`, lukilabs clone, agisota origin, `rox.one` | P2 | charter draft | owner signature |
| C-VER | Some docs say 0.11.5; package is 0.11.4 | P3 | `package.json` | do not bump here |
| C-GIT1 | `feat/shell-ext-activate2` leftover 1/44 | P2 | remote triage memo | rebase or abandon; **do not merge** |
| C-GIT2 | `fix/sandbox-env-strip` leftover 2/535 | P1 | remote triage | **do not merge** |
| C-APP | Electron production; CLI/viewer production-adjacent; iOS/cloud/modal experimental | info | `docs/product/2026-08-13-app-maturity.md` | do not ship experimental as prod |
| C-OMP | `docs/omp-integration-gap.md` internally contradictory; AGENTS.md still says MCP source proxies not passed in v1 | P3 | docs | later docs-only |

### Next steps (C)

1. Sign `docs/product/2026-08-13-branding-charter.md`.
2. Only then edit README / clone URL.
3. Rebase-or-abandon leftover remotes; never merge `fix/sandbox-env-strip`.

**Stop:** `DO IT ALL` is not a charter signature. README untouched this wave.

---

## D — blocked product initiatives (not implementation defects)

| Initiative | Why blocked | Do not |
|---|---|---|
| SiYuan `mode: managed` | G2 OPEN; G1 TBD | invent G1 thresholds; start managed kernel |
| ROX Notes Imports UI | security + G1/G2 | implement Imports |
| Mind-map native engine | design ≠ spec; dirty tree already has files | mix into this worktree |
| Voice | separate worktree | mix |
| iOS / cloud-gateway / modal-gateway | experimental | treat as production |
| OpenClaw dashboard | fail-closed | mix with Hermes Stage C |

---

## This wave (verified in worktree, uncommitted)

| Slice | Result |
|---|---|
| B-migrateNotes | `LOCAL_ONLY`; onboarding ROX channels classified for exhaustiveness |
| B-owned-root-policy | module + notes-root checks + absolute import paths |
| B-notes-migration assertNotesImportPaths | notes-migration now calls `assertNotesImportPaths` (`resolveWorkspaceNotesRoot` FR-5, `migrateCraftNotesToSiyuan`; `listNotesForMigration` rejects relative + credentials.enc AC-4 + identity.json EC-3) |
| B-owned-root FR-3/EC-1 tests | `.env`, `credentials.enc.quarantine`, empty path |
| B-owned-root EC-3 | `listNotesForMigration` and `migrateCraftNotesToSiyuan` reject `identity.json`; `assertNotConfigSecretPath` throws for it |
| B-owned-root FR-3 destination | `assertNotesImportPaths` rejects `destinationRoot` `credentials.enc` and `identity.json` |
| B-owned-root FR-7 dest relative + empty | relative `destinationRoot` and empty source/destination rejected; `migrateCraftNotesToSiyuan` rejects secret `workspaceRoot` |
| B-owned-root FR-5/EC-3 notesPath | `resolveWorkspaceNotesRoot` throws for `notesPath` `identity.json` / `credentials.enc`; allows `/tmp/selected-craft-vault` |
| B-owned-root FR-7 notesPath relative | `resolveWorkspaceNotesRoot` throws for relative `notesPath`; CF-2 EC-2 quarantine name has no `CRAFT01` payload |
| B-owned-root FR-4 default notes | `resolveWorkspaceNotesRoot` allows default `workspaces/{id}/notes` when `notesPath` is unset |
| B-owned-root EC-2 missing dir | `listNotesForMigration` returns `[]` for a missing non-secret notes directory |
| B-owned-root FR-4 empty notesPath | `resolveWorkspaceNotesRoot` allows default `workspaces/{id}/notes` when `notesPath` is empty |
| B-owned-root EC-2 regular file | `listNotesForMigration` returns `[]` when `notesRoot` is a regular file |
| B-CF2 FR-5 v1 dual-read | hostname v1 store on injected path decrypts and is not quarantined |
| B-PSI FR-09 digest hints | stored session digests keep `projectHints` and `entityHints` arrays |
| B-PSI FR-09 digest fields | stored Craft/OMP/HTML digests keep title, timestamps, entryCount, roles, and toolCalls |
| B-PSI FR-06 catalog identity | indexed catalog items keep id, sourceId, relativePath, adapter, content/metadata digests, byteSize, timestamps |
| B-owned-root FR-2 CONFIG_DIR | `CONFIG_DIR` remains an eager snapshot while `getConfigDir()` follows call-time env |
| B-PSI NFR-04a workspace stores | sources/catalog/audit keyed by workspace ID under `.craft/session-intelligence/{id}`; same root does not share or clobber |
| B-PSI FR-09 projectHints | stored Craft/OMP/HTML digests keep bounded title `projectHints` and empty `entityHints` |
| B-PSI NFR-01 payload skip | unchanged indexed sessions are not re-snapshotted/extracted on rescan |
| B-PSI FR-09 workingDirectory | stored Craft/OMP/HTML digests keep fixture `workingDirectory` values |
| B-CF2 FR-5 v1 reopen | hostname v1 store remains readable on a fresh backend instance and is not quarantined |
| B-cf2 FR-7/EC-3 + EC-1 tests | quarantine mkdir failure leaves original; missing file returns null without quarantine dir |
| B-cf2 EC-2 | well-formed CRAFT01 file that fails both decrypt keys is quarantined (dir 0700, file 0600), not deleted |
| B-cf2 FR-3 AC-2 modes | short-garbage quarantine asserts dir 0700 and file 0600 |
| B-cf2 FR-3 AC-3 modes | wrong-magic quarantine asserts original gone, dir 0700, file 0600, and name has no payload |
| B-G0 worksheet | Gate 0 worksheet created (facts MISSING) |
| B-cf2 | quarantine instead of unlink; temp `filePath` tests |
| B-SI W1–W5.2 | local catalog + candidate extraction/inbox; rank/confirm/correct/hide/delete; Memory panel mount at `MemoryListPanel.tsx:670`; no prompt inject; no sync |
| B-CF1 | still absent on HEAD; unauthorized untracked envelope copy removed this wave; not re-implemented |
| A0 reprobe | FAIL CLOSED @ `2026-08-19T09:48:50Z`; apply.log not created |
| OMP default | already Grok xhigh |
| package.json | restored valid JSON; added `./session-intelligence` and `./config/paths` exports |

---

## Definition of done (program)

```
BLUF: partial
A-ops: R3 offline recovery/security repairs committed; verification artifact remains stale and A0 is blocked on clean verification plus the exact R3 start token
B-security: implemented in worktree; not merged
C-branding: unsigned
Verified: focused bun test 167 pass / 0 fail 3459 expect() calls across 15 files @ 2026-08-19T09:48:50Z (routing, owned-root, CF-2, notes-migration, PSI W1–W5.2 including lastScanCounts persist, FR-03 skip .git/node_modules, FR-03 extractSessionDigestFromFile final-symlink skip, FR-04 file-size-limit partial+audit, FR-04 total-byte maxCandidateBytes scan-limit+audit, AC-05 malformed-beside-valid partial, UI 3 skipped/error toast, W5.1 locale keys in all 10 files, FR-W52-3 280-char bound, W5.2 cap/inbox/untitled/rank-fail/non-authoritative tests, candidate audit sourceId; renderer-capability mint/compare; WS handshake binds WebContents only via validated capability; SI + MIGRATE_NOTES LOCAL_ONLY)
Next owner strings:
  1. АПPLY HMA-20260809-A1-R3
  2. branding charter signature
```

### HMA R3 post-remediation evidence — 2026-08-20

- Historical bundle commit: `78df77a`; no push.
- Offline contract-repair commits: `feaced2`, `4dc9b1dc`, `e505d80f`, `cb36c864`, `b16cc69f`, `98f2f2c2`, `a840f27b`; no push.
- Historical 173-test / 35-path manifest evidence applies to `78df77a` only; it is stale after all current source commits.
- Current repair verification is limited to static source parsing because the owner prohibited retrying blocked tests/checksum/verifier in this turn.
- No A0/live Hermes, OMP, Tailscale, Syncthing, credential, process, permission, messaging, or target mutation occurred.
