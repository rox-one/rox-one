# Architecture deepening — 2026-08-13

Visual report (not in git): `/tmp/architecture-review-20260813085257.html`

Vocabulary: module, interface, implementation, depth, seam, adapter, leverage, locality. No CONTEXT.md / ADRs in-tree; domain names come from the inventory.

## Candidates

| # | Deepening | Strength | Ticket |
|---|---|---|---|
| 1 | Session module — internal seams for share, spawn-env, turn complete, collection fields | Strong | 09 |
| 2 | Config module — one defaults JSON, env resolver, secret fragment behind `getRuntimeEnvOverrides()` | Strong | 04, 07 |
| 3 | OMP lifecycle module — real child vs `omp-fake-cli` as the two adapters | Worth exploring | after 01/12 |
| 4 | Identity module — Craft and Rox name adapters | Worth exploring | 07 |
| 5 | Shell module — classic and unified as layout adapters; one real panel makes PanelHost a real seam | Worth exploring | 11 |
| 6 | Retire leftover MCP adapters (one adapter = hypothetical seam) | Worth exploring | 10 |
| 7 | Merge credentials into secrets chain | Speculative | decide at 06 |

## Top recommendation

Deepen the session module first. Deletion test: putting share/spawn/complete back into one file re-creates the merge queue the last program hit. Callers keep the same SessionManager interface; tests stay on that seam.

## Grilling

Pick a candidate to walk constraints, dependencies, and what sits behind the seam. Default if nobody picks: candidate 1.
