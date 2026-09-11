---
name: agent-teams
description: Captain-led multi-agent team using Rox spawn_session + send_agent_message. Opt-in via Appearance → workbench.harness.agentTeams. Do not install Cordis @nanmicoder/dsh-agent-teams into Rox.
---

# Agent Teams (Rox first-party)

Use this skill when the user asks for Agent Teams, `/agent-teams`, or a captain + durable members with dependency-aware tasks.

This is **not** the DeepSeek Harness Cordis plugin `@nanmicoder/dsh-agent-teams`. That package targets DSH (`dsh plugin …`) and stays on the H6 skip-list as `agentTeamsRuntime`. Rox maps the same *product idea* onto existing tools.

## When the flag is off

If Appearance → Workbench → **Agent Teams** (`workbench.harness.agentTeams`) is off, tell the user to enable it, then continue. Do not invent a second orchestrator UI.

## Captain protocol (this session is captain)

1. Restate the goal and propose a **staged plan**: roster (roles) + task DAG (dependencies). Do **not** spawn members until the user approves (or they explicitly say to run immediately).
2. After approval, create members with `spawn_session` (one session per member). Prefer clear labels such as `agent-teams`, `role:<name>`, `team:<short-id>`.
3. Give each member a focused prompt: role, assigned tasks, acceptance criteria, and instruction to report back via `send_agent_message`.
4. Track tasks in chat (and optionally a workspace note under `.agent-teams/` if the user wants durable state). States: `pending → claimed → in_progress → completed | failed | cancelled`.
5. Enforce dependencies: do not assign or claim a task until its dependencies are completed.
6. Coordinate with `send_agent_message` (mailbox). Captain consolidates; members may message each other when useful.
7. When done, summarize results in this chat and stop spawning. Archive by labeling sessions `team:archived` (do not delete unless the user asks).

## Tool mapping (DSH plugin → Rox)

| DSH coordination tool | Rox equivalent |
| --- | --- |
| `agent_teams_create` | This session becomes captain; open a plan in chat |
| `agent_teams_add_member` | `spawn_session` with role prompt + labels |
| `agent_teams_remove_member` | Stop assigning work; optional archive label on that session |
| `agent_teams_create_task` | Record task + dependencies in the plan |
| `agent_teams_claim_task` / `update_task` / `reassign_task` | Update the plan; message the member |
| `agent_teams_send_message` | `send_agent_message` |
| `agent_teams_status` | `list_sessions` + plan summary in chat |
| `agent_teams_resume` / `delete` | Continue or archive the team in chat |

## Hard rules

- One captain (this session) leads one active team at a time.
- Do **not** install or require Cordis / `dsh-cordis` / npm `@nanmicoder/dsh-agent-teams` inside Rox.
- Prefer `SessionFanOutSheet` / existing fan-out only when the user wants simple parallel replicas — Agent Teams is role + DAG oriented.
- Keep harness flags default-safe: never assume Agent Teams is enabled.
- Do not invent a Timeline surface or a second workflow engine.
