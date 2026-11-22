# Rox Workstreams

This folder is the working blueprint for how Rox grows from one product into five divisions without losing the two transitions that matter:

1. A person with an idea gets a working cloud machine in minutes.
2. Their sessions, knowledge and agent stay in one desktop workspace.

## Files

| File | What it is |
|---|---|
| `blueprint-20261122.md` | The full blueprint: demand map, 5 divisions, 15 groups, 30 frontier tasks, 14 parked tasks, 7 guilds, operating model, hiring map, 90-day plan. |
| `task-board.json` | The machine-readable task board generated from the blueprint. 30 tasks, 14 parked tasks, computed waves and dependencies. |
| `open-roles-summary-20261122.json` | The job-board snapshot: totals, department counts, recency and representative titles for the five anchors and seven adjacent companies. |
| `validate_blueprint.py` | The structural check: counts, IDs, group coverage, dependency integrity and cycles. |
| `org-map.html` | A one-page visual org map for reading and printing. |

## Check

```bash
python3 docs/workstreams/validate_blueprint.py
```

Expected output:

```text
BLUEPRINT VALID
divisions=5 groups=15 tasks=30 parked=13
waves=w1:10 w2:10 w3:6 w4:3 w5:1
```

Use `--write` to regenerate `task-board.json` after editing the blueprint.

## How to use this

1. Read the one-page summary in `blueprint-20261122.md`.
2. Name five division leads and fifteen group stewards.
3. Put the 30 tasks on the board. Only the ten wave-1 tasks start as `ready`.
4. Claim a task for 10 days. If nobody claims it, re-scope it to one day or kill it.
5. Demo the acceptance every week. A status sentence is not evidence.
6. Refresh the job-board snapshot before a hiring decision; the boards change daily.

## Status

Working draft, 22 November 2026. The blueprint reflects the `feat/cloud-byok` tree and the official job boards read on that date. The branch is ahead of `plans/problem-inventory.md`; check the named path before claiming a task.
