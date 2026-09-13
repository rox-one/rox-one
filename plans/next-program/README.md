# Next program tickets

Tracer-bullet slices for the program in `plans/next-program-spec.md`.

| # | Title | Blocked by | Wave |
|---|---|---|---|
| 01 | First-run credential step | — | 1 |
| 02 | Escape OAuth callback HTML | — | 1 |
| 03 | Viewer share residual hardening | — | 1 |
| 04 | One source of truth for config defaults | — | 1 |
| 05 | Mount knowledge-to-session CTAs | — | 1 |
| 06 | Secrets settings vertical slice | — | 1 |
| 08 | Web UI parity and dead knobs | — | 1 |
| 10 | Contract leftover MCP servers | — | 1 |
| 15 | Register OMP on the backend factory | — | 1 |
| 09 | Deepen the session module | — | 0 (start first) |
| 07 | Identity env/config-dir resolver | 04 | 2 |
| 11 | One real unified-shell panel | 05 | 2 |
| 12 | OMP codes on the protocol union | 09 | 2 |
| 13 | Live-credential first-turn E2E | 01, 12 + human secret | 3 |
| 14 | Decision tickets | — (human) | any |

Frontier (can start now): 01, 02, 03, 04, 05, 06, 08, 09, 10, 14, 15.

## Recovery (issue #130)

These ticket files were unique to `rox/next-program-planning-7c33` (PR #11 closed unmerged). Implementation already landed on `main` via later ticket branches; this restores the inventory so the cards stay auditable.

| Ticket | Shipped on main |
|---|---|
| 01–02, 15 | wave1 #17 |
| 03 | #19 |
| 04 | #18 |
| 05 | #15 |
| 06 | #21 |
| 07 | #26 |
| 08 | #16 |
| 09 | #23 |
| 10 | #22 |
| 11 | #24 |
| 12 | #25 |
| 13 | #27 + live #32 |
| 14 | #28 + `plans/next-program/decisions/` |
| 16–18 | #29, #30, #31 (evidence here; no original ticket files) |

Do not re-merge the planning branch: it is 529 commits behind `main`. Ticket bodies stay historical (`ready-for-agent`); this table is the status of record.
