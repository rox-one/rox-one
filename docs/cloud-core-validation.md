# Cloud core validation receipt

## Revision and toolchain

- Base: `f63294ba4fffa7238b46b24e918925a313ad0b12`.
- Worktree: `/Users/t/Projects/rox-cloud-core-fixes-20260930`.
- Branch: `fix/cloud-core-baseline-20260930`.
- Worker: `/root/cloud_recovery`.
- Host: macOS arm64, local checkout. These results are distinct from the lead's Linux Cloud canary.
- Bun: `1.3.14 (0d9b296a)`, reused read-only from `/Users/t/Projects/archive/rox-remaining-20260930/native-ui-20260930/profile/toolchain/bun/1.3.14/bun-darwin-aarch64/bun`.
- TypeScript: `5.9.3` from this worktree's frozen dependency install.
- Install: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 <bun> install --frozen-lockfile --ignore-scripts`, exit 0. No package manifest, lockfile, or `bunfig.toml` diff.

## Changes and proof

1. `validateLocator` checks the plain-object prototype and every own property descriptor before reading `type` or values. It rejects inherited fields, non-enumerable fields, symbols, and accessors. Enumerable readonly/frozen data fields remain valid. `attachCredentialRef` uses this validator through its existing `CredentialRefRegistry.prototype.register.call` boundary; direct registration and provider updates share it.
2. `PersonalTaskStore.setWhen(id, when, now = Date.now())` uses the provided local-day clock. Existing `TasksPage` and `TaskDetail` callers pass two arguments and retain their wall clock behavior. Fixed-clock Things tests now pass their `now` to each date mutation. A regression deliberately uses a different wall clock and verifies Today and upcoming calendar behavior; a control verifies the original two argument API.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused red run before source edits | 46 pass, 9 fail, 55 tests | `/tmp/rox-cloud-core-red-20260930.log` |
| Focused green run after source edits | 55 pass, 0 fail | `/tmp/rox-cloud-core-focused-green-20260930.log` |
| Full `bun test packages/core` | 815 pass, 0 fail; 77 files, 3494 assertions | `/tmp/rox-cloud-core-suite-20260930.log` |
| `packages/core`: `bun run tsc --noEmit` | Exit 2, 13 pre-existing diagnostics | `/tmp/rox-cloud-core-typecheck-20260930.log` |
| Base-revision core typecheck using the same TypeScript | Exit 2, same 13 diagnostics | `/tmp/rox-cloud-core-typecheck-baseline-20260930.log` |
| Normalized typecheck comparison | Identical diagnostics; no new errors | `/tmp/rox-cloud-core-typecheck-comparison-20260930.json` |
| `git diff --check` | Pass | Local Git check |

## Typecheck baseline requiring follow-up

| Count | Diagnostic | Path and lines |
| ---: | --- | --- |
| 1 | TS2367: `"event"` compared with `"task"` | `src/calendar/calendar.test.ts:71` |
| 11 | TS2339: `Rox2Result.verification` unavailable on `Rox2LegacyOkResult` | `src/rox2/__tests__/platform-contract.test.ts:706,752,819,920,1047,1146,1245,1344,1447,1554,1661` |
| 1 | TS2367: verification status union compared with `"verified"` | `src/rox2/meeting-conation-shell.ts:29` |

The lead authorized investigation and repair of these diagnostics after the three core failures are committed. This receipt does not claim a green package typecheck yet.

## Evidence hashes

| Evidence | SHA-256 |
| --- | --- |
| Red run | `c4053901f8046a76ccb18b8261d11b7231d445ebddc8aadb14d00f3715fb5fee` |
| Focused green | `75890461e78271be83784a63bfc82887867c582c331931cd573620bf88acc1d8` |
| Core suite | `0e9b594205a1752154fa616678bdac9fffa7b95ae129ca91c924756844da2f9b` |
| Typecheck current | `ac2a4c764fdeecdb6ad523af137879ed464fda0632ef853acdf56156c040fc95` |
| Typecheck base | `818f1576c16e1c614b121327af45048c3c8f4008ac76268ca6788fa606cf8864` |
| Typecheck comparison | `26cdd96749ffda5f8841e869641ad202608f9325ac1f4760034283c34b1a4a38` |

## Integration boundary

The lead observed a separate uncommitted September union with a partial attachment-level locator repair (`LOCATOR_FIELDS`, `assertAllowedFields(input.locator)`, and accessor descriptor checks), an `account_replica_key` credential kind, and task recurrence/id/reminder work. This branch targets main and repairs the shared registry boundary. Integration must preserve the September union's unrelated additions; this worktree does not modify that union. Earlier targeted history searches did not find committed fixes; that finding does not exclude these uncommitted repairs.

Cloud configuration, publication, network policy, and browser actions remain owned by the lead. This worker prepares local commits for lead review before any push or PR.
