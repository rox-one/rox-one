# Session Map — native XYFlow shell over SessionSceneGraph

**Date:** 2026-08-20  
**Status:** approved (implementation plan: `docs/superpowers/plans/2026-08-20-session-map-workflow.md`)
**Repo:** `rox-one/rox-one` (`Git/rox-one`)  
**Supersedes for Map tab:** card-grid `SessionFlowCanvas` as the Map renderer  
**Does not supersede:** `2026-08-08-entity-mindmap-views-design.md` for notes/knowledge; SiYuan Graph / Mind map tabs stay  
**Does not rewrite:** session jsonl, Outline tab, `SessionWorkbench` rails

## 1. Problem

Map today is a static scene grid (`SessionFlowCanvas`): depth × lane cards, cameras that only change spacing, click leaves the map, fork is a corner button. It is neither a native Rox surface nor a live execution view.

The product ask is **not** “rebuild Dify inside Rox”. It is a **hybrid**:

```
Session / transcript / jsonl
        ↓
SessionSceneGraph          ← source of structure
        ↓
XYFlow canvas              ← visual shell / editor
        ↓
┌──────────────────────────────┐
│ Observe existing execution   │
│ Edit / fork / compose        │
│ Replay / fan-out             │
└──────────────────────────────┘
        ↓
existing child sessions / runtime
```

XYFlow is a **shell**. Jsonl + `projectSessionScenes` remain the model. Runtime remains `onCreateSession` / `branchFromMessageId` / existing agent loop.

## 2. Decisions (this brainstorm)

| ID | Choice |
|---|---|
| Product slice | Map first. Outline stays current git-log. Standard stays full chat. No memo/inspector rails. |
| Nature | Hybrid: observe live projection **and** act (fork / compose / replay / fan-out). Not a new Workflow entity. |
| Editor | **XYFlow (`@xyflow/react`)** as renderer only. |
| Source of truth | Parent **jsonl is read-only**. Graph never rebases, deletes, or reorders history. |
| Layout writeback | Node positions, camera, zoom → **localStorage pin**, keyed by `sessionId`. Not jsonl. |
| Structural writeback | Fork, rewrite, fan-out, drag-edge-as-fork → **new child session** via existing `onCreateSession`. |
| Select chrome | Single click = stay on map, select node. **Double-click** = Standard + `scrollToMessage`. |
| Fan-out | v1+ from selected node: playbook holes + variants. Caps **8 running / 32 accepted** (`FANOUT_PARALLEL` / `FANOUT_MAX`). |
| Cameras | Карта / Поток = two spacings of the **same** `SessionSceneGraph` (tight depth×lane vs wide LR). Same node ids. Not two models. |
| Visual | Native Rox chrome: `bg-background`, `border-border`, existing type scale, motion, RU i18n. Not Dify blocks, not a third design system. |
| Live | Streaming session re-projects; known scene ids keep pin; new scenes appear with status pulse. |

## 3. What “write to history” means

Three channels, never mixed:

| User action | Written | Where |
|---|---|---|
| Pan / zoom / drag node / switch Карта↔Поток | layout pin | `localStorage` `rox.sessionMap.layout.<sessionId>` |
| Fork / rewrite / fan-out / connect-as-fork | new session | new jsonl + `branchFromMessageId` + `branchFromSessionId` |
| Double-click / checkout | nothing | navigate Standard + `ChatDisplay.scrollToMessage` |

Parent transcript is **append-only by the agent**, not by the canvas. Compose on canvas means: pick a scene, write a prompt, spawn a child that continues from that message. It does **not** mean splicing a node into the parent graph.

## 4. Visual language

The map must feel like the same product as Standard chat — dark surface, quiet chrome, one accent on selection — not a foreign workflow studio.

- **Stage:** full bleed under `EntityViewTabs`. No left memo, no right inspector.
- **Floating chrome (pointer-events only on controls):** Live · N scenes; Карта | Поток; вписать; сброс раскладки; XYFlow minimap (bottom-right, muted). Same 11px muted labels as current canvas.
- **Nodes (`scene`):** Rox card — 1px `border-border`, `bg-card`, 12px radius, trigger line, up to 4 tool chips (`font-mono` 10px), optional outcome clip, status dot (ok / error / pending / streaming). Selected = violet ring already used on the grid, not a neon outline.
- **Edges:** thin bezier; `continue` = `stroke-border`; `fork` = violet, slightly thicker. Git-client energy (colored lineage), not fat Dify pipes.
- **Node toolbar (selected only):** Форк · Fan-out · Переписать (compose / replay seed). No permanent icon dump.
- **Empty:** existing `entityView.workbenchNoScenes`.
- **Motion:** `motion` for appear/status; no decorative particles.

Карта vs Поток change **layout algorithm and spacing**, not node chrome.

## 5. Architecture

```
session.messages (jsonl projection in renderer)
        │
        ▼
projectSessionScenes(sessionId, messages)     packages/core
        │  SessionScene + SceneEdge
        ▼
toFlowElements(graph, pin, camera)            renderer adapter
        │  Node<SceneNodeData>[] / Edge[]
        ▼
<ReactFlow>  custom nodeTypes.scene
        │
        ├─ observe: live graph, status, select
        ├─ layout pin: persist positions
        └─ act: fork / rewrite / fan-out / edge-as-fork
                │
                ▼
        onCreateSession({ branchFromMessageId, branchFromSessionId, name })
```

### Units

| Unit | Path | Does | Depends on |
|---|---|---|---|
| `SessionSceneGraph` | `packages/core/src/mindmap/session-scene-graph.ts` | Project transcript → scenes/edges | messages |
| Layout pin | new `packages/core/src/mindmap/session-map-pin.ts` | parse/serialize pin; ignore corrupt | `sessionId` |
| `toFlowElements` | `apps/electron/src/renderer/components/session-workbench/to-flow-elements.ts` | Graph + pin + camera → XYFlow | core graph + pin |
| `SceneNode` | `apps/electron/src/renderer/components/session-workbench/SceneNode.tsx` | Custom node chrome + toolbar | XYFlow node API |
| `SessionWorkflowEditor` | `apps/electron/src/renderer/components/session-workbench/SessionWorkflowEditor.tsx` | Host ReactFlow, cameras, live, actions | ChatPage callbacks |
| Fan-out sheet | existing `SessionFanOutSheet` | holes + variants, caps | `planFanOutJobs` |
| ChatPage Map branch | `ChatPage.tsx` | Mount editor instead of `SessionFlowCanvas` | editor props |

`SessionFlowCanvas` is replaced as Map host. Do not keep two Map renderers. `SessionWorkbench` stays unused (no rails).

### XYFlow dependency

Add `@xyflow/react` to `apps/electron` only. Core stays renderer-free. Import CSS once in the editor host. Theme via CSS variables already used by Rox (`--background`, `--border`, `--foreground`), not XYFlow default look.

## 6. SessionScene → node contract

Unchanged graph types:

- `SessionScene.id`, `triggerMessageId`, `triggerPreview`, `outcomePreview`, `tools[].toolCallId|name|status`, `parentSceneId`, `childSceneIds`, `orphaned`
- `SceneEdge.from`, `to`, `kind: 'continue' | 'fork'`

Flow mapping:

- Node id = `scene.id` (`scn_…`)
- Node data carries the scene; click payload for chat is `triggerMessageId`
- Edge id = `${from}->${to}`
- Edge `kind` stored in `data` for stroke
- Orphan scenes render with amber border; still selectable

Cameras:

- **Поток:** depth × lane, `xStep=280`, `yStep=140` (LR reading). No extra layout library in this cycle.
- **Карта:** same algorithm, `xStep=200`, `yStep=108`. Same ids.

Pin file shape:

```ts
type SessionMapPin = {
  v: 1
  sessionId: string
  camera: 'map' | 'flow'
  viewport?: { x: number; y: number; zoom: number }
  nodes: Record<string, { x: number; y: number }>
}
```

Unknown scene ids in pin are dropped. Missing ids get auto position.

## 7. Interactions

| Gesture | Result |
|---|---|
| Click node | Select; toolbar; do **not** leave Map |
| Click pane | Clear selection |
| Double-click node | `setSessionView('standard')` + `scrollToMessage(triggerMessageId)` |
| Форк | `onCreateSession` from `triggerMessageId`; navigate to child |
| Переписать / compose | child session + seed composer (`onInputChange`) + navigate. Replay = same path, seed = original trigger preview |
| Fan-out | open `SessionFanOutSheet` bound to selected scene; launch ≤32 jobs, ≤8 running |
| Drag node | update pin only |
| Drag from handle to empty / new | treat as fork from source (child session). **Not** a parent jsonl edge |
| Drag between two existing scenes | ignored (would imply rebase). Toast: форк создаёт новую сессию |
| Pan / pinch / scroll zoom | viewport; persist in pin (debounced) |
| Карта / Поток | keep pin; only unpinned nodes take the new spacing. **Сброс раскладки** clears pin for this session and auto-layouts the current camera |

Streaming: when `session.messages` grows, re-run `projectSessionScenes`. Existing node positions stay. New/pending tools pulse on the owning scene.

## 8. ChatPage wiring

Keep exclusive views:

- `standard` → `ChatDisplay` only
- `map` → `SessionWorkflowEditor` full stage (`h-full min-h-0 flex-1`)
- `outline` → current `SessionGitOutline`
- `graph` / `mindmap` → existing SiYuan surfaces

Reuse existing handlers: `handleWorkbenchFork`, `handleWorkbenchRewrite`, `handleCreateChildSessions`, `handleMindMapNavigate` (double-click only), `sessionMetaMap` unused on Map.

`workbenchMessages` mapping stays `SceneMessage` (`content`, optional `toolStatus` / `status` from `statusType`).

## 9. i18n

Reuse: `entityView.flowLive`, `workbenchCameraMap`, `workbenchCameraFlow`, `workbenchNoScenes`, `workbenchFork`, `workbenchRewrite`, playbook keys.

Add only if missing: fit/reset layout labels (`entityView.mapFit`, `entityView.mapResetLayout`) RU/EN. No English chrome on RU UI.

## 10. Errors

- Empty graph → empty state, chrome still visible.
- Corrupt pin → ignore, auto-layout, no toast spam.
- Fan-out `total > 32` → throw/toast, launch nothing.
- `onCreateSession` fail → toast `toast.couldNotCreateBranch`, canvas stays.
- XYFlow load fail → do not silently fall back to the old grid in the same tab (one renderer).

## 11. Tests

Keep: `session-scene-graph`, `session-digest`, `session-variables`, `fan-out-jobs` (13).

Add (core, no DOM):

- pin parse/serialize; corrupt → empty
- `toFlowElements`: one scene + continue edge → one node + one edge; node id = scene.id; click id = `triggerMessageId`
- camera change does not change node ids
- fan-out from a scene still uses `branchFromMessageId` = trigger, never writes parent jsonl (unit on planner/jobs)

Renderer: no full Electron suite in this cycle. Visual check: Standard chat; Map paints with height; select stays; dblclick returns to chat.

## 12. Out of scope

- Outline git-graph rewrite
- Persistent memo / inspector rails
- Separate Workflow entity / Dify runtime
- Rebase, delete, or reorder parent jsonl from the canvas
- Merge two sessions
- In-canvas interpreter / in-process agent swarm
- Replacing SiYuan Graph / Mind map
- Notes/knowledge Map (still `MindMapHost` per 2026-08-08)
- Materializing the map as a knowledge file

## 13. Relation to 2026-08-08 entity maps

That spec’s Map is outline-first `MindMapGraph` + `MindMapHost` for session/note/knowledge. This spec **specializes the session Map tab** to a scene-graph XYFlow shell because session execution is a DAG of turns/tools, not a heading tree. Session Standard and Outline tabs are unchanged. Notes/knowledge keep `MindMapHost`. Do not invent a second session graph model: still `projectSessionScenes`.
