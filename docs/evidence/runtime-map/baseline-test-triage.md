# Integrated test failure baseline comparison

Compared integrated runtime-all-tests.log (observed 86 failures at capture; runner had not reported final totals) against exact origin/main commit `3342fad30166bdf005d296e0d5fe24d36d4df5fb`.

Baseline is detached `/workspace/scratch/d0a9c1c6c094/worktrees/baseline-main`. Dependency links reuse installed external packages while all `@rox/*` workspace links point to baseline source, preventing integrated source leakage. No root source, AGENTS, permissions, credentials, protected configuration or live accounts were modified. No full typecheck was run.

Actual executable for `bun` below: `/workspace/scratch/d0a9c1c6c094/tooling/node_modules/@oven/bun-linux-x64/bin/bun`. All commands ran from the baseline worktree.

| Failure family | Integrated observed | Classification | Baseline result | Exit | Log |
|---|---:|---|---|---:|---|
| Ansible syntax-check | 1 | Environment: ansible-playbook absent | 0 pass / 1 fail | 1 | `baseline-fleet.log` |
| Protected PostgreSQL macro integration | 57 | Environment: protected database configuration unavailable before database admission; two representative fixtures reproduced | 0 pass / 2 fail | 1 | `baseline-postgres.log` |
| Installed Electron meeting fixture | 3 | Environment: missing X server / DISPLAY; dbus denied; ready-file timeout | 0 pass / 1 fail, 20.38s | 1 | `baseline-electron.log` |
| Legacy Markdown migration fixture + native task ACK fixture | 3 | Existing baseline tests: unsorted readdir assertion; old bool receipt and title property assumptions | 7 pass / 3 fail | 1 | `baseline-native-focus-legacy.log` |
| ROX2 plans registry + theme selector | 5 | Existing baseline tests: 217-card authority vs 200 fixtures; selector literal predates material guards | 18 pass / 5 fail | 1 | `baseline-plans-theme.log` |
| Messaging access checks + lock identity | 6 | Existing baseline tests: accessMode/binding rejection and old executable heuristic expectations; PDF passes in this isolated grouping | 32 pass / 6 fail | 1 | `baseline-messaging-lock-pdf.log` |
| Connection refresh fixture | 6 | Existing baseline fixture: configured legacy stub lacks required native OMP connection; matching exact errors on baseline | 2 pass / 6 fail | 1 | `baseline-refresh-runtime.log` |
| PDF URL import | 1 | Existing baseline cross-test mock contamination: web-api.test.ts mocks worker URL as empty string; isolated PDF test passes | 4 pass / 1 fail | 1 | `baseline-pdf-contamination.log` |
| Runtime trace RPC exact fixture + runtimeMap.latestWindow translation | 4 | Current changes: baseline exact fixtures pass; new RPC channels and missing translation require root fix | 22 pass / 0 fail on baseline | 0 | `baseline-ipc-i18n.log` |

## Commands

### Ansible syntax-check

```sh
bun test ops/fleet-infra/control-plane.test.ts -t 'ansible-playbook syntax-check'
```

Exit 1; `offline-gates/baseline-fleet.log`.

### Protected PostgreSQL macro integration

```sh
bun test tests/macro-integration/wp-48-native-policy.test.ts tests/macro-integration/wp-01-server.test.ts -t 'real Resource revoke and policy advancement|WS creates a canonical private project'
```

Exit 1; `offline-gates/baseline-postgres.log`.

### Installed Electron meeting fixture

```sh
bun test tests/e2e/meeting-agents/harness.test.ts -t 'bootMeetingApp starts a live Electron pid'
```

Exit 1; `offline-gates/baseline-electron.log`.

### Legacy Markdown migration fixture + native task ACK fixture

```sh
bun test tests/lark-suite-extension/legacy-markdown-migration-fence.test.ts tests/rox-suite/focus-native-ack.test.ts
```

Exit 1; `offline-gates/baseline-native-focus-legacy.log`.

### ROX2 plans registry + theme selector

```sh
bun test plans/rox2/__tests__/rox2-192-200-leftover-honesty.test.ts plans/rox2/__tests__/program.test.ts packages/shared/src/config/theme-vibrancy.test.ts
```

Exit 1; `offline-gates/baseline-plans-theme.log`.

### Messaging access checks + lock identity

```sh
bun test packages/messaging-gateway/src/__tests__/access-control.test.ts packages/messaging-gateway/src/__tests__/gateway-button-access.test.ts packages/server-core/src/bootstrap/lock-identity.test.ts packages/ui/src/__tests__/pdfjs-url-import.test.ts
```

Exit 1; `offline-gates/baseline-messaging-lock-pdf.log`.

### Connection refresh fixture

```sh
bun test packages/server-core/src/sessions/refresh-connection-runtime.test.ts
```

Exit 1; `offline-gates/baseline-refresh-runtime.log`.

### PDF URL import

```sh
bun test apps/webui/src/adapter/web-api.test.ts packages/ui/src/__tests__/pdfjs-url-import.test.ts
```

Exit 1; `offline-gates/baseline-pdf-contamination.log`.

### Runtime trace RPC exact fixture + runtimeMap.latestWindow translation

```sh
bun test apps/electron/src/shared/__tests__/ipc-channels.test.ts apps/electron/src/renderer/__tests__/i18n-keys-coverage.test.ts
```

Exit 0; `offline-gates/baseline-ipc-i18n.log`.

## Interpretation limits

61 observed failures are environmental gate failures (57 protected PostgreSQL, 3 Electron display readiness, 1 Ansible). PostgreSQL and Electron families were reproduced with representative cases; the other cases in those families share the exact admission failure in the integrated log and were not all re-run.

21 failures are existing baseline fixture/code mismatches or test-process mock leakage; all affected selected files were reproduced on baseline. The remaining 4 failures were introduced by current changes to exact RPC channel inventory and the missing runtimeMap.latestWindow locale key; root was notified with reproduction details for correction. The baseline comparison does not assert that the full suite or installed native platforms pass.

## Subsequent correction verification

The four newly introduced exact RPC/locale gates were corrected by the coordinator. At integrated HEAD `5fc80f66af102c95bae53ac7025423d68d8f0377`, the same IPC inventory and renderer locale tests passed **22 tests, 0 failures, exit 0**; see `offline-gates/runtime-final-ipc-i18n.log`. This does not convert the earlier incomplete general suite into a full-suite pass.
