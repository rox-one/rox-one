# Toolchain and isolated test-runner recovery — 2026-10-04

Frozen source #1448: `e572bbdf0b6952b3a0274f1312f347157aee52d1`. Only `packages/shared/src/toolchain/manager.ts` and `scripts/test-all.ts` are production changes. The source manager is selectively adapted: current non-git-npm presence/native/managed runtime checks are retained rather than replaced by source generic existence checks.

Actual before controls reproduce one Windows physical-current-copy failure (15/1) and three old runner failures (0/3). The changed source passes42 controls/231 assertions; every15 existing toolchain test file executes separately through the actual new runner,133pass/0fail/3explicit skips/2253 assertions. Exact native executable prerequisites pass1/0/5. Dedicated runner/manager and complete current Electron strict types both exit0. Joined main a199 reconciles with all four owned source/test blobs unchanged; the initial full Electron check and renewed joined check are separately retained.

The runner has a distinct whole-suite process-tree deadline, private HOME and XDG/AppData roots, exclusive logs and bounded opened-file snapshots, canonical ancestor identity checks before/after reading, and a64MiB total output budget. Output overflow or incomplete process cleanup fails; it cannot become a green truncated run. Normal success includes captured output byte counts and hashes. Checked leaf renaming may retain the original snapshot, while execution rechecks its manifest hash. No source bytes are read after the deterministic ancestor-replacement or oversized-source denials.

Reproduce focused controls with pinned Bun1.3.14/Node22.23.3 available on PATH:

```sh
bun test --timeout=40000 scripts/rox-readiness-ui-001.runner.test.ts packages/shared/src/toolchain/__tests__/rox-readiness-ui-001.git-npm-recovery.test.ts
bun test --timeout=40000 scripts/rox-readiness-ui-001.runner-electron.test.ts
node node_modules/typescript/bin/tsc --noEmit -p docs/integration-history/toolchain-test-runner-recovery-20261004/typecheck-config.json
node node_modules/typescript/bin/tsc --noEmit -p docs/integration-history/golden-task-drafts-recovery-20261004/typecheck-config.json
```

The explicit toolchain manifest records actual filenames/source hashes and each real child command; it does not claim a full repository run. All logs, prior failures and result reports remain attached here. Windows layout tests use real disposable files plus simulated platform selection; installed native Windows/runtime18.4.12 and full release acceptance remain separate.
