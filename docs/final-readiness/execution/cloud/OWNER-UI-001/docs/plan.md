# UI-001 continuation plan

| Task | Owner | Inputs and dependency | Output and verification |
|---|---|---|---|
| V1 Recover provenance | current agent | exact HEAD, AGENTS, original task and diff | preserved contract/prior result, source hashes |
| V2 Qualify tests | current agent | V1, task-local Bun 1.3.14, frozen install | baseline regression/typecheck logs |
| V3 Fix live geometry | current agent | V2, failing actual Jotai tests | normalized live/persisted state, reload/storage failures and events |
| V4 Fix host/load recovery | current agent | V2, actual callback reproductions | route-key isolation, selected deletion recovery, async negative controls |
| V5 Verify and deliver | current agent | V3/V4 | focused/entry regression, comparison with baseline, local patch/commit and structured result |

External platform replay depends on actual target runners and the lead-owned shared parser/integrated-candidate outputs. Ready independent verification continues here. No cloud worker is launched by saving this plan.
