# R24 workflow editor compatibility verification

Executed against the coordinator root worktree while latest main integration was in progress (current HEAD at inspection: `3f456e33e0664d2381d86f1168fae8cd8d803eda`). No source changes were made.

## Existing offline roundtrip checks

```sh
bun test packages/core/src/mindmap/__tests__/session-map-pin.test.ts packages/core/src/mindmap/__tests__/session-scene-graph.test.ts packages/shared/src/workflows/__tests__/canvas-spec.test.ts apps/electron/src/renderer/components/session-workbench/__tests__/draft-nodes.test.ts apps/electron/src/renderer/components/session-workbench/__tests__/workflow-spec-editor.test.ts apps/electron/src/renderer/components/session-workbench/__tests__/map-editing-ux.test.ts apps/electron/src/renderer/components/session-workbench/__tests__/canvas-node-editing.test.ts apps/electron/src/renderer/components/session-workbench/__tests__/to-flow-elements.test.ts
```

Exit **0**; **73 pass, 0 fail, 246 assertions**. Raw output: `offline-gates/runtime-r24-tests.log`.

The existing behavior checks cover version-1 layout pin serialization with camera, viewport and node coordinates; user resize dimensions; wrong session/version rejection; draft edge serialization; both true/false condition branch ports; imported named-port normalization; sticky colors and frame roles; workflow document save/reopen, saved versions, fork/version comparison, immutable export/import and shared permission validation; scene fork projection and ReactFlow positions from retained pins.

```sh
bun test packages/shared/src/sessions/__tests__/branch-from-session-id.test.ts apps/electron/src/renderer/components/session-workbench/__tests__/fan-out-jobs.test.ts
```

Exit **0**; **5 pass, 0 fail, 13 assertions**. Raw output: `offline-gates/runtime-r24-branches-isolated.log`.

The lineage test writes an actual temporary `session.jsonl`, reads it back and calls the real `listSessions` authority; `branchFromSessionId` and `branchFromMessageId` remain intact. Fan-out retains source-message lineage and existing authority limits.

A broader attempted command additionally including `pi-turn-anchors.test.ts` ran during coordinator merge and could not parse `SessionManager.ts` due to an active merge marker. That attempt is recorded in `runtime-r24-branches.log` and is **not** counted as a passing gate or a runtime-map regression.

## Wiring review

`ChatPage.tsx` keeps the existing single ChatDisplay beside the map and supplies a real lazy `SessionWorkflowEditor` in the explicit editor slot, with original session/messages/relatedBranches/fork/rewrite/createChildren/openMessage/openSession props. The editor still loads `rox.sessionMap.layout.<session>`, legacy draft storage and `rox.sessionMap.workflow.<session>` through original codecs and writes those same keys. The editor and those codec sources are unchanged relative to origin/main `3342fad30`.

`ChatDisplay.tsx` dispatches header workflow selection as `craft:session-view` with `mode:'editor'` and current panel identity. ChatPage consumes mode and RuntimeMapView synchronizes changed initialMode through its existing effect. A repeated header request to an unchanged editor-mode prop after a manual toolbar mode switch was passed to the canvas owner for review.

Root ChatDisplay after latest main merge has no conflict markers; Bun TSX parse and file-scoped diff check both exit **0**. Welcome portrait, grey suggestions over composer, history dismissal, draft append, source dependencies, approval suppression and message map actions remain; main scroll ownership, voice and textarea ref additions remain.

## Status and limits

R24: **PASS(unit/offline storage roundtrip + code wiring review)**. These checks do not prove a browser mounted actual legacy editor, session switch/unmount persistence or installed desktop smoke. W8 confirmed its prior browser mounting harness did not supply an editor prop and is adding the real retained component with storage fixtures and navigation callbacks. No new implementation-mirroring tests were added.

The pinned Bun executable is `/workspace/scratch/d0a9c1c6c094/tooling/node_modules/@oven/bun-linux-x64/bin/bun`.
