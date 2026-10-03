# Session Map XYFlow Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `SessionFlowCanvas` Map tab with an XYFlow shell over `SessionSceneGraph` so the session Map is a live, native Rox canvas that observes execution and forks/fan-out via child sessions.

**Architecture:** jsonl stays read-only. `projectSessionScenes` remains the model. Renderer maps scenes to XYFlow nodes/edges. Layout/camera/viewport persist in localStorage (`rox.sessionMap.layout.<sessionId>`). Fork, rewrite, fan-out, and connect-as-fork call existing `onCreateSession` / `branchFromMessageId`. Click stays on the map; double-click opens Standard chat.

**Tech Stack:** `@xyflow/react` in `apps/electron` only, `@craft-agent/core/mindmap`, React, bun tests, existing `SessionFanOutSheet`.

**Spec:** `docs/superpowers/specs/2026-08-20-session-map-workflow-design.md`

## Global Constraints

- Repo: `/Users/marklindgreen/Git/rox-one` only. Do not implement in `/tmp/rox-one-old`.
- Skip formatters, eslint, and project-wide suites. Run only the slice unit tests named below.
- Do not touch Outline, `SessionGitOutline`, memo/inspector rails, or `SessionWorkbench`.
- Do not rewrite, rebase, delete, or reorder parent jsonl.
- Do not keep two Map renderers. After ChatPage mounts the editor, delete `SessionFlowCanvas.tsx`.
- Import mindmap symbols from `@craft-agent/core/mindmap`.
- New UI copy via i18n, RU + EN, keys alphabetically in locale JSON.
- Fan-out caps remain `FANOUT_PARALLEL=8` / `FANOUT_MAX=32`.
- Do not commit unrelated files (`collection-menu-row`, sidebar, etc.).
- Do not run `bun add` outside `apps/electron` for `@xyflow/react`.

---

### Task 1: Layout pin (core)

**Files:**

- Create: `packages/core/src/mindmap/session-map-pin.ts`
- Create: `packages/core/src/mindmap/__tests__/session-map-pin.test.ts`
- Modify: `packages/core/src/mindmap/index.ts` (append exports only)

**Interfaces:**

```ts
export type SessionMapCamera = 'map' | 'flow'

export type SessionMapPin = {
  v: 1
  sessionId: string
  camera: SessionMapCamera
  viewport?: { x: number; y: number; zoom: number }
  nodes: Record<string, { x: number; y: number }>
}

export function sessionMapPinStorageKey(sessionId: string): string
// `rox.sessionMap.layout.${sessionId}`

export function parseSessionMapPin(
  raw: string | null | undefined,
  sessionId: string,
): SessionMapPin | null

export function serializeSessionMapPin(pin: SessionMapPin): string

export function pruneSessionMapPin(
  pin: SessionMapPin,
  knownSceneIds: ReadonlySet<string>,
): SessionMapPin
```

`parseSessionMapPin` returns `null` for missing/corrupt/wrong `v`/wrong sessionId/non-object. Unknown node ids are dropped by `pruneSessionMapPin`. `serialize` is `JSON.stringify` of the pin.

- [ ] **Step 1:** Failing bun tests for key, round-trip, corrupt → null, wrong sessionId → null, prune drops unknown ids.
- [ ] **Step 2:** Implement + export from `index.ts`.
- [ ] **Step 3:** `bun test packages/core/src/mindmap/__tests__/session-map-pin.test.ts` — pass.

Do not commit.

---

### Task 2: `toFlowElements` adapter

**Files:**

- Create: `apps/electron/src/renderer/components/session-workbench/to-flow-elements.ts`
- Create: `apps/electron/src/renderer/components/session-workbench/__tests__/to-flow-elements.test.ts`

**Interfaces:**

```ts
import type { SessionScene, SessionSceneGraph, SessionMapCamera, SessionMapPin } from '@craft-agent/core/mindmap'

export type SceneNodeData = { scene: SessionScene }

export type FlowSceneNode = {
  id: string
  type: 'scene'
  position: { x: number; y: number }
  data: SceneNodeData
}

export type FlowSceneEdge = {
  id: string
  source: string
  target: string
  data: { kind: 'continue' | 'fork' }
}

export function autoScenePosition(
  depth: number,
  lane: number,
  camera: SessionMapCamera,
): { x: number; y: number }
// map:  x=24+depth*200, y=24+lane*108
// flow: x=24+depth*280, y=24+lane*140

export function toFlowElements(
  graph: SessionSceneGraph,
  pin: SessionMapPin | null,
  camera: SessionMapCamera,
): { nodes: FlowSceneNode[]; edges: FlowSceneEdge[] }
```

Rules:

- Node id = `scene.id`. Edge id = `${from}->${to}`. `source`/`target` = scene ids.
- Depth from `parentSceneId` (cycle → 0). Lane = order of scenes at that depth.
- If `pin.nodes[scene.id]` exists, use it. Else `autoScenePosition`.
- Camera change must not change node ids.
- No `@xyflow/react` import in this file.

- [ ] **Step 1:** Tests: one continue edge → one node + one edge; node id = scene.id; click payload `data.scene.triggerMessageId`; camera change keeps ids; pinned position wins.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `bun test apps/electron/src/renderer/components/session-workbench/__tests__/to-flow-elements.test.ts` — pass.

Do not commit.

---

### Task 3: XYFlow editor + ChatPage mount

**Files:**

- Modify: `apps/electron/package.json` — add `@xyflow/react` (run `bun add @xyflow/react` in `apps/electron`)
- Create: `apps/electron/src/renderer/components/session-workbench/SceneNode.tsx`
- Create: `apps/electron/src/renderer/components/session-workbench/SessionWorkflowEditor.tsx`
- Modify: `apps/electron/src/renderer/pages/ChatPage.tsx` — Map branch only
- Modify: `packages/shared/src/i18n/locales/en.json`, `ru.json`
- Delete: `apps/electron/src/renderer/components/session-workbench/SessionFlowCanvas.tsx`

**Editor props:**

```ts
export type SessionWorkflowEditorProps = {
  sessionId: string
  messages: SceneMessage[]
  onFork?: (messageId: string) => void
  onRewrite?: (messageId: string, prompt: string) => void
  onCreateChildSessions?: (jobs: FanOutChildJob[]) => void | Promise<void>
  onOpenMessage?: (messageId: string) => void
}
```

Behavior (spec §7):

- Full-bleed `h-full min-h-0 flex-1 flex-col`. Import `@xyflow/react/dist/style.css` once in the editor.
- Theme via Rox CSS variables (`--background`, `--border`, `--foreground`). No default XYFlow look.
- Floating chrome: Live · N; Карта | Поток; Вписать; Сброс раскладки; muted MiniMap bottom-right.
- Custom `nodeTypes.scene` = `SceneNode`: `bg-card`, 1px `border-border`, 12px radius, trigger line, ≤4 tool chips, outcome clip, status dot (error if any tool error; pending if any pending; else ok). Orphan = amber border. Selected = violet ring.
- Selected-only toolbar: Форк / Fan-out / Переписать. Rewrite seeds `scene.triggerPreview`.
- Click node = select, stay on map. Click pane = clear. Double-click node = `onOpenMessage(triggerMessageId)` only.
- Drag node / pan / zoom → debounce-write pin (`sessionMapPinStorageKey`).
- Карта/Поток keep pin; only unpinned nodes take new spacing. Reset clears pin for this session and auto-layouts current camera.
- `onConnect` between two existing scenes: toast `entityView.workbenchForkHint`, add no edge.
- `onConnectEnd` onto empty pane: `onFork(source.triggerMessageId)`.
- Live: `projectSessionScenes` on `messages`; keep pin positions; new scenes auto-place.
- Empty graph: chrome + `entityView.workbenchNoScenes`.
- Fan-out: existing `SessionFanOutSheet` bound to selected scene; default holes `[]` (sheet falls back to trigger preview).
- Corrupt pin: ignore, auto-layout, no toast.

**ChatPage Map branch:**

```tsx
<SessionWorkflowEditor
  sessionId={sessionId}
  messages={workbenchMessages}
  onFork={handleWorkbenchFork}
  onRewrite={handleWorkbenchRewrite}
  onCreateChildSessions={handleCreateChildSessions}
  onOpenMessage={(id) => handleMindMapNavigate({ kind: 'message', id })}
/>
```

Do **not** call `handleMindMapNavigate` on single click.

**i18n add if missing (alpha order):**

- `entityView.mapFit`: EN `Fit`, RU `Вписать`
- `entityView.mapResetLayout`: EN `Reset layout`, RU `Сброс раскладки`

Reuse: `flowLive`, `workbenchCameraMap`, `workbenchCameraFlow`, `workbenchNoScenes`, `workbenchFork`, `workbenchRewrite`, `workbenchForkHint`.

- [ ] **Step 1:** Add `@xyflow/react` to `apps/electron`.
- [ ] **Step 2:** Implement SceneNode + editor. Delete `SessionFlowCanvas.tsx`. Wire ChatPage. Add i18n keys.
- [ ] **Step 3:** Confirm no remaining `SessionFlowCanvas` imports. Do not run full electron typecheck.

Do not commit.

---

## Spec coverage

| Spec | Task |
|---|---|
| Pin parse/serialize/corrupt | 1 |
| toFlowElements / cameras / ids | 2 |
| XYFlow host, gestures, fork/fan-out, ChatPage | 3 |
| Outline / rails / Dify runtime / jsonl rewrite | out of scope |

## Verify (orchestrator)

```
bun test \
  packages/core/src/mindmap/__tests__/session-map-pin.test.ts \
  packages/core/src/mindmap/__tests__/session-scene-graph.test.ts \
  packages/core/src/mindmap/__tests__/session-digest.test.ts \
  packages/core/src/mindmap/__tests__/session-variables.test.ts \
  apps/electron/src/renderer/components/session-workbench/__tests__/to-flow-elements.test.ts \
  apps/electron/src/renderer/components/session-workbench/__tests__/fan-out-jobs.test.ts
```
