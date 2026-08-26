# M3 surface graph

- **Status:** Draft for review (slice A of path D)
- **Date:** 2026-08-26
- **Ground SHA:** `a862b07` (`main` after UEW M0) / worktree based on `origin/main`
- **Skill:** `project-understanding-graph` (read-only)
- **Parent spec:** [architecture.md](./architecture.md)
- **Not this document:** FR/AC slice spec (B), agent workflow (C), product code

Every edge below cites a current path. `[INFERENCE]` is marked.

---

## 1. Target and scope

**In:** local Electron first-class terminal as a Resource Surface: new `SurfaceTab` kind, control RPC, **separate** binary plane, detach + renderer-reload reattach.

**Out:** WorkItem kernel, parent Turso WorkGraph, SSH/relay, Web/iOS, PR #69 adapt, packaged G7 numbers.

---

## 2. Nodes

| ID | Node | Evidence |
| --- | --- | --- |
| N1 | `SurfaceTab` union (7 kinds) | `packages/core/src/platform/surfaces/types.ts` |
| N2 | `surfaceTabToDescriptor` / `surfaceTabDurableKey` | `packages/core/src/platform/surfaces/descriptor.ts` (exhaustive `switch`) |
| N3 | `SurfaceRegistry` (one contribution per kind) | `packages/core/src/platform/surfaces/registry.ts` |
| N4 | `WorkspaceSurfaceHost` | `packages/core/src/platform/surfaces/host.ts` — interface only |
| N5 | `WorkbenchTab` = `SurfaceTab \| { kind: 'legacy-route' }` | `packages/core/src/platform/workbench/types.ts` |
| N6 | `parseWorkbenchTab` | `packages/core/src/platform/workbench/migrate.ts` |
| N7 | `describeWorkbenchTab` | `packages/core/src/platform/workbench/layout.ts` |
| N8 | Renderer `SurfaceTabLike` **twin** | `apps/electron/src/renderer/platform/layout-snapshot.ts` |
| N9 | URL layout SoT | same file + `NavigationContext` (cited in ADR-0001) |
| N10 | `SessionManager` | `packages/server-core/src/sessions/SessionManager.ts` |
| N11 | `WsRpcServer` JSON envelopes | `packages/server-core/src/transport/server.ts` |
| N12 | `RemoteBrowserPaneManager` | `packages/server-core/src/sessions/RemoteBrowserPaneManager.ts` — RPC `invokeClient` |
| N13 | Native length-prefixed **JSON** frames | `packages/server-core/src/native/framing.ts` |
| N14 | `craft-exec` Bash sidecar | `native/crates/craft-exec/Cargo.toml` description |
| N15 | `craft-rund` / `run:*` | `native/crates/craft-rund`, `packages/server-core/src/native/` |
| N16 | `ConnectionWorkGraph` / `fabric*` | `packages/core/src/platform/identity/workgraph.ts` |
| N17 | UEW contract | `docs/specs/2026-08-25-unified-execution-workbench/architecture.md` |
| N18 | Layout ADR | `docs/architecture/adr/0001-rox-workbench-convergence.md` |

---

## 3. Edges

| Edge | Meaning | Evidence |
| --- | --- | --- |
| N8 ⇢ N1 | Renderer **does not import** core `SurfaceTab`; it restates the union | `layout-snapshot.ts` comment: “structural twin”; “apps/electron does not import @craft-agent/core's knowledge module” |
| N2 → N1 | Adding `kind: 'terminal'` **fails typecheck** until both switches grow | `descriptor.ts` `switch (tab.kind)` |
| N6 → N1 | Parser allowlists kinds; unknown → `null` | `migrate.ts` `parseWorkbenchTab`; test rejects `{ kind: 'work-record' }` |
| N7 → N1 | Layout describe switch | `layout.ts` `describeWorkbenchTab` |
| N3 → N1 | Duplicate kind throws | `registry.ts` |
| N9 → N8 | URL is SoT; snapshot is derived | `layout-snapshot.ts` header; ADR-0001 |
| N10 → N11 | Session mutations on JSON-RPC | `SessionManager` + `WsRpcServer` |
| N12 → N11 | Browser pane is **not** a binary plane; it still uses RPC payloads | `RemoteBrowserPaneManager.ts` |
| N13 ⇢ N14 | Sidecar frames are JSON, 4-byte length prefix, 16 MiB cap | `framing.ts` |
| N16 ⊥ N17 | Fabric graph ≠ execution WorkGraph | architecture.md §3.1, §28 |
| N5 → N4 | Two hosts, two snapshots | ADR-0001 addendum; `host.ts` vs `workbench/` |

`[INFERENCE]` Live Electron may still resolve many surfaces via `degradeSurfaceNavigationState` / legacy routes rather than a fully populated `SurfaceRegistry` (`layout-snapshot.ts` “Until W2/W5”). Terminal contribution MUST still register; it MUST NOT assume registry is the only renderer path.

---

## 4. Hotspots (blast × uncertainty × reversibility)

1. **Twin unions (N1 + N8)** — highest blast. A new kind that lands only in core will snapshot/URL-round-trip as dropped/null.
2. **Exhaustive switches (N2, N6, N7)** — compile-time if `SurfaceTab` is used; runtime-null if parser not updated.
3. **N11 vs bytes** — `[LOCKED]` architecture.md §2.3. Extending `WsRpcServer` envelopes for PTY is a spec violation.
4. **N13 temptation** — existing binary-ish framing is JSON-for-sidecar, not VT. Reuse of the *length prefix idea* is OK; reuse of the socket as PTY is `[GATED:G1]`.
5. **N10 leftover task fields** — do not grow `taskSlug` / `taskRunId`.
6. **N12 as false friend** — good *locality* pattern, wrong *transport* for bytes.

---

## 5. Conventions to reuse

- Suite S contribution shape: `match` / `buildRoute` / `policy.singletonPer` / `hostKind`.
- Terminal SHOULD use `hostKind: 'bounds-managed'` if it embeds a native view; `'dom'` if xterm in React. `[GATED]` until G1/UI choice.
- Granular `workbench.*` flags (ADR-0001); new `workbench.terminal.v1` default false (architecture.md §18).
- Durable ref only in tabs (S-02 §3.7): `{ kind: 'terminal', terminalId, sessionId? }` — `terminalId` is durable, not a React key.

---

## 6. Callers / tests that MUST move together

If `SurfaceTab` gains `terminal`:

| Surface | Why |
| --- | --- |
| `packages/core/src/platform/surfaces/types.ts` | union |
| `descriptor.ts` | two switches |
| `workbench/migrate.ts` `parseWorkbenchTab` | persist |
| `workbench/layout.ts` `describeWorkbenchTab` | debug/describe |
| `apps/electron/.../layout-snapshot.ts` `SurfaceTabLike` + tab↔route | URL SoT |
| `apps/electron/.../__tests__/layout-snapshot.test.ts` | “maps every SurfaceTab kind” |
| `packages/core/src/platform/__tests__/surfaces-registry.test.ts` | “maps all seven tab kinds” → eight |
| `workbench-migrate.test.ts` | parser |
| `[INFERENCE]` `shared/route-parser.ts` / `shared/routes` | cited by layout-snapshot |

New modules (not existing callers): `packages/server-core/src/execution/` coordinator; terminal projector + binary transport **next to** `transport/server.ts`, not inside it.

---

## 7. Verification probes (when B/C approved — not run as A)

- `bun test packages/core/src/platform/__tests__/surfaces-registry.test.ts`
- `bun test packages/core/src/platform/__tests__/workbench-migrate.test.ts`
- `bun test apps/electron/src/renderer/platform/__tests__/layout-snapshot.test.ts`
- Typecheck those packages after the union change
- Live: Electron reload after attach (D1) — only once M3 exists

A itself does **not** require these commands to pass; they define later success.

---

## 8. Open questions (need a later probe or G1)

- Is `SurfaceRegistry` fully wired in production Electron, or only tests + snapshot twin? `[INFERENCE]` partial.
- G1: extend `craft-exec` vs new crate vs `node-pty` vs multiplexer.
- D2 desktop restart: restore vs explicit `unsupported`.

---

## 9. Smallest implementation surface (preview, not authorized)

1. Widen N1 + N8 + N2 + N6 + N7 + routes.
2. New terminal contribution (dom or bounds-managed).
3. New `TerminalManager` + projector + binary plane beside N11.
4. Optional `sessionId` attach on N10 without new task fields.

Stop. B will turn this into FR/AC. C will assign agents to these nodes without file overlap.
