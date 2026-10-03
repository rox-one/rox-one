# Independent desktop repair recheck

Reviewed source revision: `354a483acc708d8130104e39525fdd0e8681058f`. Checkout HEAD: `6855bc4ffab55a5f35744ceea5761477d47174e8` (reports/evidence only after source). This is an independent source and bounded executable recheck of F1–F4 from `pocket-sso-desktop-review.md`; implementation files were not edited. No UI, deployment, push, external account mutation or real inference was performed.

## Result

All four previously reported P1 reproductions are repaired in the exercised boundary. No new actionable desktop finding was identified in this pass. This verdict is limited to these source paths and bounded fixtures; it is not native OS secret-store, real managed CLI/provider, browser onboarding, or full feature acceptance.

| Finding | Independently observed result |
|---|---|
| F1 draft/helper caller | Actual SessionManager with mock backend uses supplied RPC caller before backend creation; stale authority is rejected before query. Fresh and saved-owner cases passed in the targeted suite. |
| F2 private/public child reuse | Original actual OmpAgent + fake CLI reproduction now spawns two children. Private first prompt does not use personal ROX credential; public second prompt does. Related tests passed private→public→private, delayed old stream rejection, and model change during asynchronous native invocation preparation with no obsolete child/profile. |
| F3 mutable session ownership | Original actual SessionManager barrier reproduction selects account A for A's request while both authority contexts remain valid. Concurrent B fails `ROX_SESSION_OWNER_CONFLICT` before messages/backend seam. Title, frozen queue, late binding and exact recovered queue scenarios pass. |
| F4 logout crash restart | Original durable receipt-before-active-clear crash simulation now restores disconnected, has zero active records, drains receipt once, and capture/inference fails `ROX_ACCOUNT_NOT_READY`. Store/client are synthetic; authority is actual. Outage/clear-failure and retry tests pass. |

## Independent execution

Pinned Bun: `/Users/t/Projects/rox-release-20261003/apps/electron/vendor/bun/bun`, version 1.3.14. Environment: `NODE_ENV=test`, disposable config/workspace fixtures. Ran:

```
bun test --timeout 90000 \
 packages/server-core/src/sessions/pocket-session-resource-owner.test.ts \
 packages/server-core/src/sessions/pocket-helper-owner.test.ts \
 packages/shared/src/auth/__tests__/rox-account-authority.test.ts \
 packages/shared/src/agent/__tests__/omp-model-account-domain.test.ts \
 packages/shared/src/agent/__tests__/omp-public-runtime.test.ts
```

Result: **30 pass / 0 fail; 153 assertions; 5 files; 14.00 seconds**. This independently exercises resource conflict, title completion, queue freeze, sealed exact generation after recovery, restart logout receipt suppression, public env authority, and OMP domain process fencing. Writer's broader 54/0/typecheck results remain writer evidence, not independently repeated here.

Additional original probes and a new actual callback registration probe are preserved in `pocket-sso-desktop-recheck-evidence/`. The registration probe invokes actual `getOrCreateAgent` (backend factory replaced with a mock; actual SessionManager registers callbacks and registry functions):

- Current A callbacks update SDK ID, forward one background event, spawn one child and send one agent message. Child and target send options both retain `account-a` / `generation-a`.
- After logout and same-caller login as B, saved A SDK callback leaves `sdk-a` unchanged; saved background sink forwards no additional event; saved `onSpawnSession` and registry `sendAgentMessageFn` throw `ROX_ACCOUNT_CHANGED`. No additional child or send is created.
- The config/backend factory/callback targets are mock seams. This proves actual registration and wrapper behavior, not real provider dispatch or browser/native integration.

Original probe readbacks:

```
model domain: privateCompleted=true publicCompleted=true spawns=2;
  private personalCredentialMatches=false; public personalCredentialMatches=true
concurrency: requestAccount=account-a backendSelectedAccount=account-a;
  bothCallerContextsStillCurrent=true resultB=ROX_SESSION_OWNER_CONFLICT
restart: pendingLogout=0 connected=false inferenceError=ROX_ACCOUNT_NOT_READY;
  brokerLogouts=1 activeRecords=0
registered callbacks: coreAccount=account-a; positive writes=1 sends=2 children=1;
  late sdk=sdk-a writes=1 sends=2 children=1 spawnError=ROX_ACCOUNT_CHANGED
  sendError=ROX_ACCOUNT_CHANGED newAccount=account-b
```

The callback child printed Bun's internal `directory mismatch ... tsconfig.json` diagnostic; child and parent exited 0 with complete expected results. No implementation error was attributed to that runtime diagnostic. All spawned test sessions completed; temporary config/workspace directories were removed. Native safeStorage injection and broker responses remain synthetic, and no OS-backed keychain proof is claimed.
