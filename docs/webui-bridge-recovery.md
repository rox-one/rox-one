# WebUI optional native host-control type visibility

## Scope and ownership

Owner: WebUI bridge recovery worker, allocated by the ROX audit lead. Isolated branch `fix/webui-bridge-recovery-20260930`, based on September snapshot `0cc0402e587a8162202485cbe7831c2c50e50667`. The live September and compound checkouts are not edited. `.codegraph/` is absent from this snapshot; a scoped declaration/callsite search identified the exact boundary.

The snapshot's WebUI compiler reports three TS2339 errors in `SecuritySettingsPage.tsx`: the optional `Window.openClawHostControl` declaration lived only in the preload file, while the WebUI compiler includes renderer/shared/transport paths. All other 49 main-baseline WebUI diagnostics already have candidate repairs in the snapshot. This task addresses only the remaining declaration visibility.

## Contract and implementation

- Move the existing `OpenClawHostControlApi` interface and optional Window property to the browser-safe `apps/electron/src/shared/openclaw-host-control.ts` type module, included by both compiler projects.
- Preserve the preload module's type export for existing callers through a type-only re-export.
- Keep the property optional and the exact workspace-only methods returning `Promise<void>`; use no `any`, casts or native implementation in WebUI.
- Retain the existing preload factory, client-only exclusion, direct IPC channels and result-discarding behavior. Renderer guards and WebUI transport remain unchanged.

Owned source paths: the shared type module and native preload type import/export. Documentation paths: this receipt and scoped crosslinks in `docs/spec.md` / `docs/plan.md`. The feature program's 109-task / 489-requirement graph is unchanged; this compiler repair does not close full issue or platform acceptance.

## Dependencies and verification

Prerequisite: captured September source union and frozen dependency install with Bun1.3.14. Integration: lead reviews this local commit before publication and checks overlapping owners at landing.

Required checks: WebUI TypeScript has zero diagnostics; server and core TypeScript remain clean; existing native bridge tests prove client-only absence and native result discarding; Git diff check passes. This changes only type visibility, so no new runtime behavior test is added.

## Verification receipt

Frozen dependency install used Bun `1.3.14 (0d9b296a)` with lifecycle scripts disabled and Electron download skipped. No lockfile or package manifest changed. TypeScript version: `5.9.3`.

| Check | Observed result |
|---|---|
| `bun run webui:typecheck` | Exit 0, zero diagnostics; the snapshot previously had the three TS2339 errors |
| `packages/server`: `bun run tsc --noEmit` | Exit 0, zero diagnostics |
| `packages/core`: `bun run tsc --noEmit` | Exit 0, zero diagnostics |
| Existing `openclaw-host-control.test.ts` | 2 pass, 0 fail; client-only bridge absent, native calls retain workspace-only payloads and discard returned credentials |
| `git diff --check` | Exit 0 |

These compiler and existing bridge checks cover this type visibility change. They do not constitute browser/native feature acceptance for the full September program. The lead retains review, publication, remote readback and queue acknowledgment ownership.
