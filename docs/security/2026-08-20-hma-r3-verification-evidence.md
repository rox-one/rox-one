# HMA R3 verification evidence

- **Date:** 2026-08-20
- **Bundle:** `/Users/marklindgreen/hermes-migration-audit-20260809-121222`
- **Local commit:** `78df77a` (`fix(hma): harden revision-three remediation bundle`); no push.
- **Immutable manifest SHA-256:** `e9db5372da46fe146815150aca9b9d4e77b32fb8495a35b30d55013228359e35`.
- **Covered paths:** 35 exact regular files, matching `R3_ALLOWED_PATHS`.

## Offline contract-repair update — 2026-08-20

- Local source commit `feaced2` repaired newly audited offline R3 defects: non-config secret-text projection, typed A0 writer ledger/parse-plan isolation, D1 policy digest binding, C0 artifact binding, mandatory F0 consistency, receiveonly transport, and Lark class/exclusion agreement.
- That source commit intentionally changes covered bytes. The manifest above is historical evidence for `78df77a`; it is now stale and MUST NOT authorize R3 start.
- The new deterministic regression cases were added but not run because the owner explicitly prohibited retrying blocked test/checksum gates in this turn.

## Second offline security-repair update — 2026-08-20

- Local source commit `4dc9b1dc` adds component-wise peer-file pin/unlink, bounded secret-safe SharedMemory records, exact malformed-byte quarantine, and descriptor-backed Secure State capture streaming.
- It changes additional covered bytes. Neither historical manifest nor the `feaced2` source state is a current immutable verification artifact.
- Static source parsing completed; new regression tests are intentionally deferred with the same owner prohibition on test/checksum/verifier retries.

## Final offline recovery-hardening update — 2026-08-20

- Local source commits `e505d80f`, `cb36c864`, `b16cc69f`, `98f2f2c2`, and `a840f27b` close recovery trust/filename/pending/quarantine controls, identity binding, D1/E0 proof, and restore/sync/mode boundaries identified by static audits.
- The current covered source sequence is `feaced2` → `4dc9b1dc` → `e505d80f` → `cb36c864` → `b16cc69f` → `98f2f2c2` → `a840f27b`; every historical checksum artifact predates it and is stale.
- Static parsing was repeated for the modified Python source/test files. Behavioral tests, manifest generation, and verifier remain deferred by owner instruction.

- The prior targeted static audit result applies only to its named contracts. The newest restore/sync/mode repairs have source-parse evidence only; behavioral tests, manifest generation, and verifier remain deferred by owner instruction.

## Completed evidence

- `python3 -m unittest discover -s apply-tools/tests -p 'test_*.py'` completed with **173 tests passed**.
- All 13 copied/executed tool `--help` contracts returned exit 0.
- JSON parse checks passed for the three bundle JSON artifacts.
- All 14 fenced shell blocks in `11-apply-plan.md` passed `bash -n` extraction checks.
- `quiesce_writers.py parse-plan` accepted the R3 plan without executing a live command.
- A clean bundle check previously completed: all 35 checksums passed and `snapshot_audit_bundle.py verify-bundle` reported `ok: true`.

## Immutable verifier blocker recorded

A later post-commit verification attempt exited nonzero after generated metadata reappeared under the audit root:

- `__pycache__/approval_tokens.cpython-311.pyc`
- root and `apply-tools` `.DS_Store` files

These paths are intentionally outside `R3_ALLOWED_PATHS`; the verifier correctly rejects them. They were removed without changing any covered bundle bytes. Per the current owner instruction, the same checksum/verifier gate was not retried in this turn.

Post-cleanup structural scan found no `__pycache__`, `.pyc`, or `.DS_Store` path below the audit root. This is cleanup evidence only, not a substitute for the required clean-process verifier.

**Required next verification action:** from a clean process and the audit-root working directory, run the immutable checksum and `verify-bundle` commands once after confirming no cache artifacts exist. Do not start A0 from this evidence record.

## Authorization boundary

This is offline evidence only. It does not authorize `АПPLY HMA-20260809-A1-R3`, A1 backup, process control, Hermes configuration, permissions, pairing, messaging, target enrollment, or any remote action.