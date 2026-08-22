# HMA-20260809-A1-R3 — fail-closed remediation specification

- **Date:** 2026-08-20
- **Status:** Approved on 2026-08-20 by exact owner message `APPROVE HMA-20260809-A1-R3 REMEDIATION`.
- **Parent plan:** `/Users/marklindgreen/hermes-migration-audit-20260809-121222/11-apply-plan.md` revision 2
- **Failed evidence root:** `/Users/marklindgreen/.hermes-migration-apply/HMA-20260809-A1`
- **New plan ID after remediation:** `HMA-20260809-A1-R3`
- **Scope:** offline audit documents, apply tools, tests, and immutable manifest only; no live Hermes/OMP/Buzz/Tailscale/Syncthing mutation

## Verification evidence — 2026-08-20

- Historical immutable-bundle commit: `78df77a`; no push.
- `173` focused R3 tests passed before the historical checksum generation.
- Historical 35-path manifest SHA-256: `e9db5372da46fe146815150aca9b9d4e77b32fb8495a35b30d55013228359e35`.
- Offline contract-repair commits: `feaced2`, `4dc9b1dc`, `e505d80f`, `cb36c864`, `b16cc69f`, `98f2f2c2`, and `a840f27b`; no push. All change covered bytes, so the historical manifest is stale.
- Full evidence, cache cleanup, and required deferred verification are recorded in `docs/security/2026-08-20-hma-r3-verification-evidence.md`. No R3 start token or A0 action is authorized.

## 1. Failure that triggers revision 3

The owner sent exact `АПPLY HMA-20260809-A1`. Initialization correctly created an owner-only evidence root, but `shasum -a 256 -c checksums.sha256` failed before tool copy or A0 commands:

- checksum manifest mtime `2026-08-09T13:41:49Z`;
- 22 listed regular files, 0 symlinks;
- 7 matches, 15 mismatches;
- apply root `0700`, `apply.log` `0600`, empty tools directory `0700`;
- one evidence row: `INIT audit-checksums FAIL`;
- no `hermes`, Tailscale API/status, gateway, backup, chmod, ACL, Syncthing, messaging, or credential command ran.

Later mtimes explain why rev2 cannot verify but do not prove safe provenance. Two independent read-only reviews reject a blind checksum rebase:

- plan review: revision-blind token, unhashed executable tools, unresolved target depicted as active, conflicting channel/secret classes, incorrect Buzz quiescence, incomplete approval/rollback gates, stale live assumptions, and incomplete Lark exclusion;
- tool review: 5 high + 6 medium findings across discovery, Secure State, sync policy, SharedMemory, canary, mode rollback, and bundle verification.

Decision: preserve the failed evidence root; repair and re-verify a revision-3 bundle before asking for a new Stage C start token.

## 2. Safety boundary and authorization split

Revision-3 remediation is offline authoring only. Its process may read only the current audit root, the failed rev2 apply log metadata, its own owner-only snapshot, and harness-created fixtures. It MUST NOT probe current Hermes/OMP/Buzz/Tailscale/Syncthing/config/credential state; stale-fact corrections use captured audit artifacts only and are explicitly labeled stale until a later separately approved R3 A0.

It MAY:

- before the first edit, create an owner-only no-follow content snapshot at `~/.hermes-migration-remediation-backups/HMA-20260809-A1-R3-pre-edit/` containing only the audit-root regular files, modes, relative paths, sizes, and digests;
- edit the explicit audit-root allowlist in §3;
- add deterministic local tests/fixtures under `apply-tools/tests/`;
- remove generated `apply-tools/__pycache__/` bytecode;
- generate a new `checksums.sha256` only after every test/review gate passes.

The snapshot writer rejects symlinks/special files, opens source components no-follow, uses `0600` files/`0700` directories, writes a checksummed manifest, restores only into a disposable drill copy during remediation tests, and is retained until a separate deletion approval. Remediation approval authorizes this snapshot only; it does not authorize any live-state backup.

It MUST NOT:

- change `~/.hermes`, `~/.omp/agent`, Buzz data, Tailscale, Syncthing, launchd, cron, gateways, permissions, credentials, messages, or remote systems;
- read or print secret values;
- overwrite/delete `/Users/marklindgreen/.hermes-migration-apply/HMA-20260809-A1`;
- treat remediation approval as Stage C approval.

After a verified bundle exists, Stage C still requires a separate exact start token:

`АПPLY HMA-20260809-A1-R3`

A1/A2/A3 and every later consequential gate remain separately confirmed.

## 3. Exact remediation allowlist

Audit root: `/Users/marklindgreen/hermes-migration-audit-20260809-121222`.

### Documents and manifests

1. `00-executive-summary.md`
2. `01-environment-inventory.md`
3. `02-hermes-inventory.md` — captured-snapshot stale annotations only; no current probe
4. `05-channel-and-gateway-inventory.md`
5. `06-memory-inventory.md` — writer/quiescence and archive roots only
6. `07-tailscale-inventory.md` — target remains unresolved; no invented identity
7. `08-permissions-and-secrets-classification.md`
8. `09-risk-register.md`
9. `10-proposed-architecture.md`
10. `11-apply-plan.md`
11. `secrets-manifest.template.json`
12. `checksums.sha256` — generated last

`03-skills-inventory.json` and `04-plugins-inventory.json` remain byte-unchanged unless verification finds structural invalidity; they are still included in the final manifest.

### Apply tools

13. `apply-tools/build_secure_state.py`
14. `apply-tools/discover_surface.py`
15. `apply-tools/build_project_projection.py`
16. `apply-tools/generate_syncthing_policy.py`
17. `apply-tools/init_memory_schema.py`
18. `apply-tools/memory_canary.py`
19. `apply-tools/mode_manifest.py`
20. `apply-tools/shared_memory.py`
21. `apply-tools/verify_bundle.py`
22. `apply-tools/safe_restore.py`
23. `apply-tools/syncthing_guard.py`
24. `apply-tools/quiesce_writers.py` — new
25. `apply-tools/snapshot_audit_bundle.py` — new; pre-edit snapshot + disposable drill restore only
26. `apply-tools/approval_tokens.py` — new; strict R3 token parser/artifact binding
27. `apply-tools/memory_bridge.py` — retained, hashed, explicitly non-executable/not copied until a later approved use; do not delete evidence

### Tests

28. `apply-tools/tests/__init__.py`
29. `apply-tools/tests/test_secure_state.py`
30. `apply-tools/tests/test_discovery_projection.py`
31. `apply-tools/tests/test_shared_memory.py`
32. `apply-tools/tests/test_mode_and_bundle.py`
33. `apply-tools/tests/test_quiesce_and_plan_contract.py`
34. `apply-tools/tests/test_approval_and_snapshot.py`

No fixture subtree is stored in the immutable bundle. Tests generate a fixed schema-declared fixture set only inside registered harness temp roots and assert that exact runtime fixture manifest before use.

Worktree evidence docs permitted after verification, anchored under `/Users/marklindgreen/Projects/_craft_worktrees/do-it-all-security-slices`:

- `docs/security/2026-08-19-a-ops-runbook.md`
- `docs/security/2026-08-13-do-it-all-inventory.md`
- `docs/security/2026-08-20-hma-revision-3-remediation.md` status/evidence block

These three worktree files are outside the immutable audit bundle/checksum set and may be updated only after bundle bytes freeze. Any additional path requires a reviewed amendment and new owner approval.

## 4. Revision-3 plan corrections

### Identity and immutable bundle

- Rename plan to `HMA-20260809-A1-R3`, revision 3.
- New start token includes revision: `АПPLY HMA-20260809-A1-R3`.
- New apply root: `~/.hermes-migration-apply/HMA-20260809-A1-R3`; never reuse rev2 failed root.
- `checksums.sha256` covers every allowed regular document, JSON artifact, Python source, and test file except itself. It MUST include `safe_restore.py`, `syncthing_guard.py`, and retained `memory_bridge.py`.
- Initialization verifies: manifest hash shown at point-of-risk approval; `shasum -c`; exact expected path-set equality; no symlinks, bytecode, sockets, devices, or extra executable files; source files copied from verified open descriptors.

### Target and channel model

- A0 may discover candidates but MUST stop with target unresolved until exact `APPROVE D0 TARGET <device> <node-id>`.
- Architecture diagrams show source active executor and target stopped standby, never simultaneous consumers.
- Telegram and Buzz credentials are encrypted class C retention; only source executor is active before promotion.
- Feishu/Lark credentials are encrypted class C retention but never provisioned to target. Lark LaunchAgent, MCP adapter, and Lark-directed cron jobs are excluded/disabled at cutover, not deleted.
- Tailscale node enrollment is provider/device class D. Existing local Tailscale API secret stays source-local class C reference; rev3 cannot create, replace, rotate, print, or transfer it.

### Complete approval gates

`approval_tokens.py` accepts one plan ID, one gate, and the exact fixed-width lowercase SHA-256/artifact/identity fields below; it rejects extra/missing tokens, wrong revision, stale artifact digests, replay after a completed gate, control characters, and secret/account/chat identifiers. Canonical templates:

- `APPROVE HMA-20260809-A1-R3 A1 BACKUP <preflight-sha256>`
- `APPROVE HMA-20260809-A1-R3 A2 HERMES SMART <config-diff-sha256>`
- `APPROVE HMA-20260809-A1-R3 A3 PERMISSIONS <mode-manifest-sha256>`
- `APPROVE HMA-20260809-A1-R3 B1 PROJECT SURFACE <surface-manifest-sha256>`
- `APPROVE HMA-20260809-A1-R3 C0 ENCRYPTED STATE CHECKPOINT <state-plan-sha256>`
- `APPROVE HMA-20260809-A1-R3 C1 OFFLINE RESTORE DRILL <ciphertext-sha256>`
- `APPROVE HMA-20260809-A1-R3 D0 TARGET <device-name> <node-id> <target-proposal-sha256>`
- `APPROVE HMA-20260809-A1-R3 D1 SYNCTHING PAIR <source-device-id> <target-device-id> <policy-sha256>`
- `APPROVE HMA-20260809-A1-R3 E0 SHARED MEMORY <memory-plan-sha256>`
- `APPROVE HMA-20260809-A1-R3 F0 REAUTH <provider-plan-sha256>` — only if required
- `APPROVE HMA-20260809-A1-R3 F1 CHANNEL CANARIES <canary-plan-sha256>`
- `APPROVE HMA-20260809-A1-R3 G0 SCHEDULER STANDBY <schedule-manifest-sha256>`

D0/D1 reviewed proposals use closed typed schemas. `target_alias` is ASCII `[A-Za-z0-9._-]{1,64}`; canonical Tailscale `node_id` is `[A-Za-z0-9_-]{1,128}`; Syncthing device IDs are uppercase `[A-Z0-9-]{7,128}` with canonical hyphen placement. Token fields are byte-for-byte equal to those exact fields in the artifact whose digest appears in the token; no normalization, alternate spelling, Unicode/confusable, delimiter, or free-form identity is accepted. Other gate tokens contain only fixed words plus a digest. Thus the parser never guesses whether an arbitrary string is a secret/account/chat ID: it accepts only typed artifact members already proven secret-free.

Device/node IDs are public administrative identities, not credentials; account/chat IDs are never in tokens. Each digest binds a secret-free reviewed proposal. The apply log records plan/gate/PASS-FAIL and proposal digest only, not device/node/account/chat identifiers. No gate executes until its token parser verifies the current artifact digest, typed identity equality, and apply-state prerequisites.

### Gate state and rollback

- Every gate is a fresh process; no reliance on exported shell variables from an earlier gate.
- Owner-only `apply-state.json` records plan ID, completed gates, canonical artifact paths, checksums, writer state, and rollback pointers; never secrets.
- A1 PASS is impossible until the newly created encrypted backup is decrypted and fully restored inside a network-denied owner-only drill root, every manifest entry/digest/mode is verified, every SQLite database passes `quick_check`, and a secret-free drill report digest is committed to `apply-state.json`. Corrupt/incomplete backup makes every later gate unreachable.
- A1 always resumes/restarts the unchanged source before returning, whether PASS or FAIL. It never leaves Hermes paused while waiting for A2. C1 remains a later target-side/full-system drill, not the first proof that rollback works.
- C1 writes a checksummed secret-free drill report before cleanup. Encrypted rollback artifacts remain indefinitely.
- A3 is reachable only after apply-state proves A2 committed `approvals.mode=smart` and Tirith fail-closed. A3 snapshot/rollback scope is file/directory modes only and is exact for those modes; it never reads or writes Hermes security config. A2 config rollback is a separate safe-override rollback that explicitly refuses `approvals.mode=off` or Tirith fail-open and records any deviation from pre-A2 unsafe values.
- D0/D1 rollback language distinguishes revoke-new-grant from preserve-enrollment and cannot contradict itself.

### Writer/quiescence contract

- A0 discovers continuous writers by PID, executable path, owner, bundle/launchd identity, and restart policy; do not hardcode `Buzz` from a stale display name.
- `quiesce_writers.py` implements a persisted transaction (`begin`, `verify-fenced`, `resume`, `recover`) bound to the verified A0 writer manifest. It verifies PID start time/ancestry/executable/owner, inhibits the recorded supervisor/restart mechanism, performs graceful stop, detects auto-restart/new writers, holds the fence through capture and post-capture checks, and restores exactly the prior supervisor/running state on success, error, signal, or next-run recovery. Unknown/reused PIDs, partial stop, restart, or restore mismatch fail closed without proceeding.
- Both A1 and C0 use the transaction and guarantee `resume/recover` on every exit; the apply-state journal makes an interrupted fence recoverable before any later gate.
- A1/C0 include both Buzz application support and `~/.buzz/archive` when discovered.
- SQLite stores use backup APIs while fenced; OMP live databases require SQLite backup + WAL-aware integrity, not raw copy.

## 5. Apply-tool requirements

### `discover_surface.py`

- No ambient repository command may execute hooks, fsmonitor, pager, credential helpers, filters, or optional locks. Git probes use fixed executable/argv, `GIT_OPTIONAL_LOCKS=0`, `core.hooksPath=/dev/null`, `core.fsmonitor=false`, no shell, bounded timeout, and captured metadata only.
- Completeness is measured against an independent root ledger: captured registry/inventory/context roots plus explicit scan roots are input before traversal. Every expected root and subtree has a terminal `scanned`, `unreadable`, or `missing` row; unreadable/missing is FAIL unless an exact later owner disposition exists. Empty/partial discovery, duplicate IDs, omitted roots, traversal errors, or rows without terminal disposition are FAIL.
- Every discovered item has exactly one terminal A/B/C/D disposition; every class D row has a named provider/device reprovision/omit disposition. Secure State requires one-to-one class C coverage and provisioning manifest requires one-to-one D coverage.
- Classification is conservative: credential/session/key/cookie/env/database/WAL/SHM/provider-state material is class C or D; uncertain/high-entropy/binary content cannot become class A by default.
- Output records path/type/mode/size/digest/class/reason only; never file contents.

### `build_secure_state.py`

- Detect SQLite by header and validated sidecar relationships, not filename suffix alone; use SQLite backup API and `quick_check` for every detected DB.
- Require all expected class-C rows and discovered state roots; empty coverage is FAIL.
- Open every component no-follow, reject special files/symlink escapes, and verify stable size/digest around non-SQLite copy.
- No named plaintext archive or SQLite backup is written to disk. Non-SQLite files stream from verified descriptors into a streaming tar writer whose output pipes directly to `age`. SQLite backup uses an in-memory SQLite destination plus `serialize()` under an explicit memory/size ceiling; exceeding the ceiling fails before capture rather than falling back to disk. The embedded manifest is written last in the stream. Partial encrypted output is uniquely named and removed on producer/encryptor error, SIGINT, SIGTERM, parent death detection, or next-run stale-output recovery; SIGKILL/power loss can leave only ciphertext, never plaintext.
- Ciphertext publication is a crash-consistent state machine: (1) write unique encrypted temp; (2) wait producer/encryptor, fsync temp and parent, compute ciphertext digest; (3) atomically fsync an `apply-state.json` `ciphertext_pending` row containing temp/final relative paths and digest; (4) no-replace rename temp to final and fsync parent; (5) atomically update state to `ciphertext_committed`. Recovery verifies digest/identity: pending+temp completes publish, pending+final marks committed, both present or neither present fails closed. Later gates require `ciphertext_committed`; no overwrite or indeterminate state advances.
- The embedded manifest contains schema/version, every source projection, backup method, integrity result, and no secret values. Its non-circular `content_set_digest` is SHA-256 of canonical UTF-8 JSON (sorted keys, no insignificant whitespace) over the lexically archive-path-sorted array `{archive_path, source_digest, byte_size, mode, backup_method, sqlite_quick_check}`; the manifest entry itself is excluded. Duplicate archive paths are forbidden. Restore independently recomputes this digest from restored entries and rejects substitution, omission, duplication, or corruption. The encrypted ciphertext SHA-256 is separate and follows the pending/committed apply-state protocol above.

### Projection and Syncthing policy

- `build_project_projection.py` and `generate_syncthing_policy.py` independently validate the discovery schema, non-empty complete root/file coverage, unique IDs, and class counts.
- Only verified class A enters continuous sync; B uses SharedMemory; C stays encrypted; D is reprovisioned/omitted. Any unknown class or missing row fails.
- Projection scans its output and rejects secret-like names/content before PASS.
- Plan contains exact `syncthing_guard.py` invocations with `--policy`, `--api-key-file`, `--role`, and target `--target-root`. API key contents never enter argv/logs.
- Guard validates all managed folders before enabling/scanning any: exact folder ID/path/device set, source `sendonly`, target `receiveonly`, paused/disabled state during configuration, no unexpected peers/folders, canonical target root, and policy digest. Any wrong role/device/state or partial API write restores every captured prior field except `paused`, which is forced `true` as a fail-closed override and recorded in the secret-free report; scanning starts only after a second all-folder preflight passes.

### SharedMemory tools

- `shared_memory.py` treats every on-disk record/attachment as untrusted, including Syncthing-created peer files. Before indexing/rebuild it validates component-wise no-follow path/filename, regular-file type, version, closed payload schema, size, digest, device ID, and secret policy. On malformed/secret-bearing peer material it pauses the already-approved sync folder, accepts no derived state, and uses the E0-approved `--quarantine-recipient-file` (public age recipient only) to stream-encrypt the verified descriptor into `~/.hermes/shared-memory-quarantine/` outside every synchronized root (`0700` dir, `0600` ciphertext). Only after ciphertext digest/age decrypt drill succeeds may it remove the original under the E0 gate. If recipient/encryption/removal verification fails, it leaves sync paused and fails closed without indexing. Quarantine ciphertext is retained until separate deletion approval; metadata contains path hash/reason/digest only, never content.
- Local writes enforce the same versioned schemas/bounds and reject secret-like keys/values, credential/session/token/cookie material, and unsafe/high-entropy blobs.
- Record is source of truth. Under an owner-only lock, write record atomically then rebuild idempotency index/events deterministically; startup recovery repairs derived state only from fully validated records. No silent split-brain across record/index/event.
- `init_memory_schema.py` emits the exact executable schema enforced by the library.
- `memory_canary.py --two-device-conflict-test` is an E0 acceptance workflow after D1 pairing, not a one-root boolean. It takes exact source/target roots and expected device IDs, writes stable-ID divergent branches while disconnected, records branch digests, reconnects through the already approved pair, requires the same deterministic conflict record/digest on both peers, and cleans only its canary records. A local two-root simulation is unit coverage, never E0 evidence.

### Mode and bundle tools

- `mode_manifest.py` snapshot, forward A3 chmod, and restore all use component-wise fd-relative no-follow walks plus `fchmod`; record and recheck device/inode/type/uid/gid before mutation. Snapshot/restore requires complete entries and rejects missing/extra roots, symlinks, hardlink/inode substitution, ownership mismatch, or pathname re-open.
- `verify_bundle.py` rejects zero/partial coverage, validates schema/path set/digests, opens source and destination parents component-wise no-follow, copies from the same verified source descriptor to a unique owner-only destination temp, rechecks source/destination identity, then atomically publishes; no second unpinned path read or raceable destination.
- `safe_restore.py` receives full security review and tests for archive traversal, link/device rejection, destination no-follow, manifest completeness, SQLite integrity, and plaintext cleanup.
- `syncthing_guard.py` receives full CLI/role/root/policy tests; source and target invocations in the plan must be executable as written.

## 6. Test and review gate

Before generating checksums:

1. `python3 -m unittest discover -s apply-tools/tests -p 'test_*.py'`
2. `python3 -m compileall -q apply-tools`, then remove/reject generated bytecode from bundle
3. CLI `--help` and exact plan-invocation contract checks for every copied/executed tool
4. shell syntax extraction/check for every fenced shell block in `11-apply-plan.md`
5. JSON parse/schema checks for all JSON files; Markdown cross-reference/gate-token checks
6. deterministic fixture runs: discovery, projection, Secure State + offline restore, sync policy/guard dry run, memory conflict canary, mode snapshot/restore, bundle verification, writer quiescence simulation
7. independent `security-reviewer` on exact tool bytes
8. independent `reviewer` on exact plan/docs
9. independent Secure State digest recomputation rejects manifest substitution, omitted/duplicate entries, and corrupted payload bytes
10. quarantine fixture proves rejected peer material is encrypted directly outside synchronized roots, never indexed/re-synchronized, original removal occurs only after decrypt verification, and failure leaves sync paused
11. deny-open integration asserts the exact runtime/data/network/process exception manifests and fails on every outside-path/non-loopback/unregistered-PID attempt
12. snapshot/rollback fixtures cover completeness, no-follow symlink/special-file rejection, rename/hardlink races, modes, corrupt manifest, atomic allowlisted restore, deletion of every newly added R3 path, refusal of non-allowlisted changes, and byte-identical disposable-copy reproduction before real restore eligibility
13. approval parser/plan-contract tests accept only canonical R3 forms, verify current artifact digests/prerequisites and exact D0/D1 typed identity equality; reject valid-digest/wrong-identity, stale/replayed/wrong-plan, normalization/delimiter/confusable/overlength/injection cases; prove no canary send or consequential callback without approval
14. ciphertext crash-point tests cover every pending/publish/commit transition, published-but-uncommitted and temp-but-pending recovery, overwrite refusal, no plaintext, and no later-gate reachability from indeterminate state
15. A3 prerequisite tests reject unsafe/uncommitted A2 state; mode rollback is exact while A2 safe-override evidence never restores `off`/fail-open
16. source-preserving benchmark is not required; these are safety tools, not a performance migration

Tests may create only harness-owned temporary Git repositories, short-lived child writer processes, and an in-process loopback fake Syncthing HTTP server inside an egress-denied sandbox. They MUST NOT access existing processes, launchd, non-loopback network, live Hermes/OMP/Buzz/Tailscale/Syncthing data, home configs, or credentials. Every child/server/temp root is registered before creation and removed after the test; leaked resources fail the suite.

Additional mandatory cases: omitted/unreadable root and orphan D disposition; corrupt/incomplete A1 backup blocks later gates; abrupt producer/encryptor/parent death leaves no plaintext; writer auto-restart and mid-stop recovery; wrong Syncthing role/device/state plus partial-write rollback; malformed/secret-bearing peer records; real two-root canary simulation (unit only); symlink/rename/hardlink races for forward chmod, restore, source and destination.

A deny-open integration policy governs data-file and network access, not normal language-runtime loading. Read/execute exceptions are an explicit manifest of the resolved Python/Git/age binaries, their immutable system libraries/stdlib, `/dev/null`, `/dev/urandom`, and required OS locale/timezone metadata; their paths/digests are captured before the test. Data read/write exceptions are only the audit root, owner-only remediation snapshot root, registered harness temp roots, and three anchored worktree evidence files. Network exceptions are only the registered in-process loopback fake-server socket. Process inspection/signals are allowed only for child PIDs spawned and registered by the harness. Every other home/live path, process interface, credential location, local IPC endpoint, and non-loopback address is denied; attempted violations are path/category only and fail the suite.

## 7. Immutable checksum gate

After all tests/reviews pass:

- remove `apply-tools/__pycache__` and any test caches;
- enumerate the exact allowed bundle path set, rejecting extras;
- generate `checksums.sha256` deterministically in lexical path order;
- run `shasum -a 256 -c checksums.sha256` twice from clean processes;
- record the checksum-manifest SHA-256, path count, test counts, and review verdicts in this spec/runbook/inventory;
- recompute without changes and require byte-identical manifest;
- do not modify any covered file after generation.

Any edit after checksum generation invalidates the bundle and restarts §6–§7.

## 8. Definition of done and rollback

Remediation is complete only when:

- every finding in §4–§5 has a production fix and observable regression test;
- all docs/tools/tests agree on R3 plan ID, gate tokens, state contract, target ambiguity, channel classes, and exact CLIs;
- independent reviewers return no material findings;
- final manifest passes and covered bytes remain unchanged;
- failed rev2 apply evidence remains untouched;
- no live system was mutated.

Rollback before R3 start uses the authorized owner-only pre-edit content snapshot—not the digest-only manifest—to restore every original regular file/mode into a disposable audit-root copy first. The drill must reproduce the pre-edit manifest byte-for-byte before real restore is allowed. Real restore opens destination parents no-follow, atomically replaces only allowlisted audit files, deletes only newly added R3 tests/tool source and generated caches/checksum changes, verifies the exact pre-edit path set/digests/modes, and leaves both the snapshot and rev2 failed apply evidence intact. Snapshot deletion requires a later exact owner approval. Never use global clean/reset or touch credentials/live state.

## 9. Owner gate

Offline remediation is blocked until the owner sends exactly:

`APPROVE HMA-20260809-A1-R3 REMEDIATION`

This authorizes only §3 offline audit-bundle edits/tests and generated checksums. It does **not** authorize `АПPLY HMA-20260809-A1-R3`, A1 backup, Hermes config changes, chmod, process stop, ACL, Syncthing, messaging, target enrollment, secret handling, or any live mutation.
