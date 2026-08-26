# G1 decision — 2026-08-26

Throwaway spike comparing the four FR-20 PTY options. `craft-pty` is not assumed.
`native/crates/craft-exec` remains a Bash sidecar; extending it is a compared option, not a given.

chosen: native-crate

rejected:
  - craft-exec-extended: text dump into conversation, no VT snapshot barrier, no credit-framed binary plane
  - node-pty: Node ABI drift and Electron rebuild pain across main vs renderer
  - multiplexer: extra daemon (tmux/screen-class), D2 restore unclear, extra process to fence

reason: snapshot barrier + credit framing easiest next to transport/server.ts without touching codec.ts

risk: new native crate ownership in Electron main; D2 desktop restart stays explicit `unsupported` in M3; PTY bytes must never enter `serializeEnvelope` / `WsRpcServer`

## Spike notes (D0 / D1 / framing)

- D0 detach: native crate can keep the PTY in the host process; tab close is detach, not destroy.
- D1 reload: server-owned VT snapshot + seq barrier is a crate + projector job, not a sidecar text dump.
- Binary framing cost: length-prefixed `{ seq, epoch, kind, payload }` beside existing RPC; not inside codec.ts.
- Electron main vs sidecar: main-owned crate avoids a second JSON-for-sidecar socket as the PTY (architecture N13).
