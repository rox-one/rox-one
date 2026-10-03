# OMP transport fixture followup

The public `rox/standard` transport fixture now supplies a fresh trusted caller context through the existing in-memory Pocket authority. Production previously rejected these tests with `ROX_TRUSTED_ACCOUNT_REQUIRED` before starting the fake peer. Seven happy/recovery cases failed, while ten generic malformed-peer checks could falsely pass on that same account error.

The repair changes only `packages/shared/src/agent/__tests__/omp-rpc-transport-agent.test.ts`. It restores the prior account singleton and environment, confines generated profiles to temporary config roots and verifies their disposal. All original model identity, payload, negotiation and recovery assertions remain. A new missing-context control observes no child invocation and no RPC frames. Every malformed-peer case verifies the exact transport error and the appropriate negotiation/catalog frames.

## Qualified final proof

The source base was `c33f00eed2adf22ad6da610325602d6dfa26af7b`, with the test-only fixture edit uncommitted during execution. `result.json` records the fixture SHA-256 and twelve input hashes before/after. The lead records the final commit binding separately.

- Bun 1.3.14 and Node 24.21.0: actual resolver/spawn fallback control exited 0 with `ENOENT` and no executable launched.
- Exact isolated file: 18 passed, 0 failed, 133 assertions; actual parent exit 0.
- Account authority/public runtime/query/transport/permission/hidden-window collision: 58 passed, 0 failed, 318 assertions across six files; actual parent exit 0.

The isolated command was `bun test ./packages/shared/src/agent/__tests__/omp-rpc-transport-agent.test.ts`. The complete collision command and pinned executable paths appear in `integrated-c33f00e-receipt.json`.

Final runs set `OMP_CLI_PATH` to the nonexistent project-local `work/omp-forbidden-native-fallback` before each process. Existing `useFakeOmpEnv` restores that sentinel, so loss of a fixture override fails with `ENOENT` instead of selecting an installed runtime. The incoming `omp-native-launch.test.ts` was excluded.

## Timing and preserved failures

Original 8-second `chatEvents` bounds remain unchanged, as does the 8-second profile-disposal deadline. Nine test declarations expanding to 18 cases now have an explicit 30-second outer case budget for Pocket setup, independently bounded chat turns and disposal. The collision used `--timeout 30000` solely as its outer allowance; no `ROX_OMP_TEST_TIMEOUT_MS` override was present.

The initial repaired fixture passed 18/0/133 under the original implicit 5-second outer default. An exact local `bun run test:mcp-onboarding` attempt then encountered host contention: its first child passed 151/0/637, and the combined second child ended with 373 passes, 10 failures, seven errors and 1847 assertions. All ten failures were reported as 5-second outer case timeouts (six transport, four unchanged permission cases). The last RPC-sources child did not run. Every red log is retained in `logs/`; original bytes and deterministic compressed hashes are checked in `log-manifest.json`.

During that timeout cascade, a late test callback was observed launching installed `/Users/t/.local/bin/omp` in a fake workspace after process-global fixture environment had been restored. Its provider interaction was not independently traced: there is no zero-provider-attempt claim for that failed batch. The safety ancestry guard found the batch already naturally exited, so no signals were sent; all observed owned process IDs were absent at readback. `native-child-observation-790216a.json` preserves that qualification. The final guarded runs passed on current c33, which also includes incoming production launch-generation cancellation fences.

## Scope and remaining acceptance

The Pocket authority uses in-memory records and a stub client. Existing public-runtime collision tests also exercise credential-manager records in temporary `ROX_CONFIG_DIR` roots. The real user/global/auth source stores were outside the write scope; that statement does not imply temporary stores were unused or claim a global byte audit.

The exact full onboarding command is still a remote CI prerequisite for the committed integrated candidate. Earlier 790 results cannot be promoted to whole current c33 proof, and this fixture validation does not extend the separately bound 0a full-CI or 8e native receipts. Original platform/provider acceptance and `fullDoDClosed:false` remain explicit.
