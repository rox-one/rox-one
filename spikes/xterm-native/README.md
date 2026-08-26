# Xterm + native crate spike

Throwaway planning spike. Spec: [`docs/specs/2026-08-25-unified-execution-workbench/xterm-native-spike.md`](../../docs/specs/2026-08-25-unified-execution-workbench/xterm-native-spike.md).

G1 already chose `native-crate` ([`g1-decision.md`](../../docs/specs/2026-08-25-unified-execution-workbench/g1-decision.md)). This note is the mount + wiring plan, not a live PTY.

Do not ship a crate from this directory. Do not assume the name `craft-pty`.

## Renderer: replace the placeholder

`apps/electron/src/renderer/platform/terminal-contribution.ts` today:

- `hostKind: 'dom'`
- `render()` returns `null` (placeholder)

Plan (next slice, not this PR):

1. Keep `hostKind: 'dom'` for xterm-in-React (surface graph: bounds-managed only if a native view).
2. `render(tab)` returns `<TerminalXtermHost terminalId={tab.terminalId} requestedFlags={...} />`.
3. That host calls `planXtermMount`. Flag-off → nothing. Flag-on → a single `div[data-uew-xterm-host]` and, later, `new Terminal().open(el)`.
4. xterm is a view. Server VT snapshot + seq barrier stay canonical. No client scrollback replay (D1).
5. This PR only adds `terminal-xterm.tsx` (planner + stub factory). Contribution stays unwired.

## Native: `pty.rs` via napi or sidecar

New workspace crate, name TBD. `src/pty.rs` owns spawn / write / resize / kill + process-group teardown. `packages/server-core/src/execution/terminal/pty.ts` `createPty` becomes a thin caller.

| Adapter | Where it lives | D0 detach | D1 reload | D2 desktop restart |
| --- | --- | --- | --- | --- |
| napi | `.node` loaded by Electron main | yes (main holds fd) | yes (snapshot barrier) | **unsupported** (`napi-main-died`) |
| sidecar | Unix socket next to `native/apps/craft-native` | yes (sidecar holds fd) | yes | **restore** only if sidecar pid is live; else `unsupported` / `sidecar-dead` |

Pick sidecar if D2 restore is required. Pick napi if M3 honesty (`unsupported`) is enough and we want fewer processes.

Neither adapter may put PTY bytes on `WsRpcServer` / `serializeEnvelope`. Control = `TerminalControl` RPC. Bytes = `TerminalFrame` binary plane.

## D2 restore hardening

M3 AC-10 allows restore **or** explicit `unsupported`. Hardening:

1. On desktop start, read a restore ledger row (`terminalId`, `epoch`, `adapter`, `sidecarPid?`).
2. Liveness check: napi → dead with main; sidecar → `kill(pid, 0)` / equivalent.
3. Live sidecar → `attach` + snapshot barrier, then xterm mount.
4. Dead / napi → show `unsupported`. Never paint a live terminal over a missing process.

## Risk

- napi: Electron ABI + rebuild pain (the reason G1 rejected `node-pty`); D2 cannot restore.
- sidecar: second process to fence; must not become a tmux-class multiplexer (already rejected).
- Wiring xterm before the crate lands invites a fake live tab.
- Name collision if someone adds `craft-pty` without G1.

## Rollback

1. Leave `workbench.terminal.v1` and `execution.coordinator.v1` default `false` (already true).
2. `git revert` this commit. Stub and docs disappear. Contribution still returns `null`.
3. No native process, no xterm package, no WorkItem, no RPC change to undo.
