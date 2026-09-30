# CI runner and server lifecycle recovery

Baseline: `f63294ba4fffa7238b46b24e918925a313ad0b12`. Owner: `/root/cloud_recovery`; root owns integration, review and remote delivery. This branch owns `.github/workflows/ci.yml`, `.github/workflows/validate-server.yml`, the existing standalone server smoke test and this documentation. It changes no application runtime, active program worktree, runner registration, permissions or secrets.

## Acceptance

1. Both validation jobs use the supported standard `macos-15` hosted runner and Bun `1.3.14`. The existing `bun run validate:ci` command, workflow/job identities and validation assertions remain effective. Dependency installs remain frozen; Electron executable download is unnecessary for these headless checks and is skipped during install.
2. The server workflow builds the agent subprocess, WebUI and real server bundle before executing the existing smoke test against the built artifacts. Its path filters include the packages, shared renderer/resources and test preloads that those artifacts depend on.
3. Runtime proof covers HTTP health and login, unauthenticated config refusal and login redirect, incorrect password refusal, cookie authentication, correct config WebSocket URL, exact built HTML delivery, valid and invalid WebSocket authentication, SIGTERM with a connected client, refused HTTP access after exit, and restart with the same config and cookie. A short server token must fail startup.
4. Child processes use the running Bun executable, a fresh temporary config directory with both supported config aliases, a generated test credential, loopback binding and a minimal environment. Credentials from the user's environment are not passed through. HTTP, handshake, startup and shutdown waits have bounds; cleanup stops every spawned process before removing owned profiles.
5. Missing server or login artifacts fail the gate. Local source tests remain usable with minimal HTML fixtures; CI explicitly supplies the real built paths. Local runtime success is distinguished from a future hosted Actions result.

## Runner evidence

Live `gh repo view` confirmed `rox-one/rox-one` is public on 2026-09-30. GitHub lists `macos-15` as a standard arm64 runner, and standard runners are free for public repositories. This choice requires no custom runner registration or paid larger runner. [Choosing a runner](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Live jobs for CI run `36699828251` and server run `36708566844` were queued with no steps. Their workflows currently target `self-hosted, macos-toolchain`. Switching the workflow label is a local proposed repair until root delivers and reads back a hosted result.

## Integration dependencies

The plain baseline still has 13 core TypeScript errors and eight server compilation diagnostics. Separate reviewed core and bridge/typecheck repairs must be integrated before the unchanged comprehensive validation command can pass. This branch introduces no new server TypeScript diagnostics.

The separate September bridge snapshot imports `node:sqlite`, which Bun 1.3.14 cannot load. Root owns that compatibility repair. This branch's built-server proof applies to main `f63294ba` plus the CI changes; rerun the same gate on the final integrated bridge revision before claiming deployment readiness.

The WebUI handler captures the configured RPC port before listen; a configured port of zero produces port zero in `/api/config`. The test briefly reserves an available loopback port and then configures that actual port. A bind collision fails startup rather than weakening the check. Runtime port-zero behavior is outside this branch.
