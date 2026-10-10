# 010 — UI agent-task controls (T11 wave items A6 + A7)

Ticket: T11 (`plans/next-program/tickets/11-shell-one-real-panel.md`) — wave items
**A6** (stop a background agent task) and **A7** (the ⌘J / ⌘⇧J agent-panel
shortcut). Program context: `plans/next-program-spec.md` (user story 28, «Primary
seam for shell»).

**Status:** ACCEPTED — shipped slice. Both open questions are answered and the
shipped behaviour is fixed here so a later agent does not re-invent a stop the
renderer cannot perform, or advertise a panel that does not exist.

**Owner:** product (pzd). An agent must not invent a per-task agent abort or an
agent-panel surface from this note.

## Context

Two UI affordances lied about what the renderer could do.

**A6 — `useBackgroundTasks.killTask`.** `apps/electron/src/renderer/hooks/useBackgroundTasks.ts`
exposed `killTask(taskId, 'agent' | 'shell')`. The `shell` branch really killed
the process through the `sessions:killShell` RPC; the `agent` branch only logged
`console.warn('Killing agent tasks not yet implemented')` and dropped the chip.
An "agent" kill was therefore renderer-only bookkeeping wearing a stop label.

**A7 — ⌘J / ⌘⇧J.** `apps/electron/src/renderer/actions/definitions.ts` declared
`agent.togglePanel` (`mod+j`) and `agent.askAboutSelection` (`mod+shift+j`), both
gated on the workbench flag `agent.panel.v1`
(`packages/core/src/platform/workbench/flags.ts`, mirrored in
`packages/shared/src/feature-flags.ts`; default **OFF**). Nothing subscribed to
either action id, and no agent panel was mounted — the keys were dead
registrations that promised a surface the shell does not render.

## A6 decision — no per-task agent kill is renderer-reachable → honest UI

A real "stop this one background agent task" is **not achievable in reasonable
scope**, and the missing capability is not a gap in the renderer but a property
of the runtime:

- The only abort the session manager exposes is **session-level**:
  `SessionManager.cancelProcessing(sessionId)` calls
  `managed.agent.forceAbort(AbortReason.UserStop)`
  (`packages/server-core/src/sessions/SessionManager.ts:8489`) — it ends the
  session's whole turn, not one background task.
- The background-task registry (`RunningBackgroundTask`,
  `packages/server-core/src/sessions/SessionManager.ts:847`, filled at
  `task_backgrounded`) records `taskId`, `toolUseId`, `intent`, `status`, timing,
  `turnId`, `workflowId` — **no abort handle**. There is nothing to signal.
- A per-task stop is owned by the agent runtime as the SDK built-in tool
  **`TaskStop`** (`packages/shared/src/agent/core/pre-tool-use.ts:119`,
  `BUILT_IN_TOOLS`): the model calls it, not the shell. The renderer has no
  channel to invoke it.

So the honest fix is in the UI, not a fake channel:

- `useBackgroundTasks` now exposes **`stopShellTask(shellId)`** (real: the
  `sessions:killShell` RPC + drop the chip) and **`removeTask(toolUseId)`**
  (drop the chip only). The agent variant is gone; the type and the docs say why
  (`apps/electron/src/renderer/hooks/useBackgroundTasks.ts`).
- `ChatDisplay` wires the chip's stop to `stopShellTask`, guarded to shell tasks
  only (`apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`).
- `TaskActionMenu` offers **Stop Task** for **shell tasks only** — the label
  states it kills the process (`sessions:killShell`). Every other chip
  (agent/workflow) offers **View Output** and the renderer-only **Убрать /
  Dismiss**, whose `chat.taskDismissHint` tooltip says plainly that it hides the
  chip while the task keeps running
  (`apps/electron/src/renderer/components/app-shell/TaskActionMenu.tsx`).
- `chat.taskDismissHint` is added to all 12 locales
  (`packages/shared/src/i18n/locales/*.json`).

No agent-kill RPC/channel was added: a channel that only flips a registry row
would be a lie, and the session Stop (`sessions:cancel`) is the honest,
already-shipped way to stop work the renderer owns.

## A7 decision — no agent panel exists → remove the dead actions/keys

`KEEP_EXPERIMENTAL` (agrees with `docs/unified-shell-verdict.md`, ticket 11).
The agent panel is a contract, not a surface:

- `PanelHost` renders only the `inspector` and `bottom` slots
  (`apps/electron/src/renderer/platform/index.tsx`); its first and only real
  contributions are the knowledge/session inspectors
  (`apps/electron/src/renderer/platform/core-panels.ts`). No agent column, no
  `agent` slot.
- `apps/electron/src/renderer/platform/right-dock.ts` is a **pure** dock-layout
  function (the W1-10 harness contract). It has no shell caller — grep finds it
  only beside its own tests and the fail-closed fixture.
- `isAgentPanelEnabled` (`packages/shared/src/feature-flags.ts`) has no consumer.
- Nothing subscribes to `agent.togglePanel` / `agent.askAboutSelection`: the only
  `useAction('agent.…')` would have been in `AppShell.tsx` and is absent.

Because the panel does not exist, the actions and their key registrations were
removed rather than left inert behind a default-OFF flag:

- `apps/electron/src/renderer/actions/definitions.ts` — dropped the
  `agent.togglePanel` / `agent.askAboutSelection` entries.
- `apps/electron/src/renderer/actions/action-flags.ts` — dropped the
  `agentPanel` flag key.
- `apps/electron/src/renderer/actions/__tests__/w1-07-shortcuts.test.ts`,
  `.../action-labels-i18n.test.ts`,
  `packages/shared/src/i18n/__tests__/w1-07-surfaces-locales.test.ts` — removed
  the two action ids and their label keys from the expected sets.
- `shortcuts.action.agentTogglePanel` / `shortcuts.action.agentAskAboutSelection`
  were removed from all 12 locales (uniform; locale parity holds).

Kept on purpose (still registered W1-15 scaffolding, not a UI promise): the
`agent.panel.v1` flag id and the pure `right-dock.ts` layout, both exercised by
the W1-15 / W1-10 gates.

## What this slice ships

- `apps/electron/src/renderer/hooks/useBackgroundTasks.ts` — `stopShellTask` +
  `removeTask`; no agent kill; docs state the runtime ownership.
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` — wired to
  `stopShellTask` (shell-only guard).
- `apps/electron/src/renderer/components/app-shell/TaskActionMenu.tsx` — honest
  comments; `handleStopShell`; Dismiss hint `chat.taskDismissHint`.
- `apps/electron/src/renderer/actions/{definitions,action-flags}.ts` — dead ⌘J /
  ⌘⇧J actions and the flag reference removed.
- `chat.taskDismissHint` in `packages/shared/src/i18n/locales/*.json` (12);
  the two dead `shortcuts.action.agent*` keys removed from all 12.
- Test-key-list updates in the three action/i18n test files above.

## What would flip this

- **A6:** a real per-task abort seam in the runtime (an abort handle on
  `RunningBackgroundTask` and a channel that signals it). Then the chip could
  offer Stop for agent/workflow tasks again, honestly.
- **A7:** a mounted agent panel (a PanelHost `agent` slot or a dock column
  rendered by the shell) plus a subscriber. Re-add the two actions, the
  `agentPanel` flag reference, the label keys and their translations **with**
  that panel, in one change — see `docs/unified-shell-verdict.md` and ticket 11.
  Until then the flag stays default OFF and nothing advertises a second product.

## Evidence

- Kill path: `packages/shared/src/protocol/channels.ts` (`sessions:killShell`,
  `sessions:cancel`), `packages/server-core/src/handlers/rpc/sessions.ts:554`,
  `SessionManager.killShell` (`:9171`) and `SessionManager.cancelProcessing`
  (`:8489`).
- Background registry: `SessionManager.ts:847` (`RunningBackgroundTask`),
  `:10976` (`task_backgrounded`), `:11071` (`task_completed`).
- Per-task stop is a model tool: `packages/shared/src/agent/core/pre-tool-use.ts:119`.
- Agent-panel contract with no surface: `apps/electron/src/renderer/platform/right-dock.ts`,
  `apps/electron/src/renderer/platform/core-panels.ts`,
  `packages/core/src/platform/workbench/flags.ts` (`agent.panel.v1`),
  `docs/unified-shell-verdict.md` (KEEP_EXPERIMENTAL, 2026-08-13).