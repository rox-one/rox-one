# Architecture deepening — 2026-08-13

Visual report (not in git): `/tmp/architecture-review-20260813085257.html`

Vocabulary: module, interface, implementation, depth, seam, adapter, leverage, locality. No CONTEXT.md / ADRs in-tree; domain names come from the inventory.

## Candidates

| # | Deepening | Strength | Ticket |
|---|---|---|---|
| 1 | Session module — internal seams for share, spawn-env, turn complete, collection fields | Strong | 09 |
| 2 | OMP lifecycle / RPC / host-tools behind internal seams; factory registry must list `omp` | Strong | 01, 12, 15 |
| 3 | Config module — one defaults JSON, env resolver, secret fragment behind `getRuntimeEnvOverrides()` | Strong | 04, 07 |
| 4 | One session query module — Filtrex views + collection chips compile to one predicate | Worth exploring | later |
| 5 | Identity module — Craft and Rox name adapters | Worth exploring | 07 |
| 6 | Shell module — classic and unified as layout adapters; one real panel makes PanelHost a real seam | Worth exploring | 11 |
| 7 | Retire leftover MCP adapters (one adapter = hypothetical seam) | Strong (cleanup) | 10 |
| 8 | One `SensitiveValuePolicy` for denylist/redaction; keep two stores | Worth exploring | decide at 06 |

## Top recommendation

Deepen the session module first. Deletion test: putting share/spawn/complete back into one file re-creates the merge queue the last program hit. Callers keep the same SessionManager interface; tests stay on that seam.

## Grilling

Pick a candidate to walk constraints, dependencies, and what sits behind the seam. Default if nobody picks: candidate 1.
