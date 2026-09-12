---
name: agent-teams
description: Captain-led multi-agent team using Rox spawn_session + send_agent_message + workspace `.agent-teams/` durable store. Opt-in via Appearance → workbench.harness.agentTeams. Do not install Cordis @nanmicoder/dsh-agent-teams into Rox.
---

# Agent Teams (Rox first-party)

Use this skill when the user asks for Agent Teams, `/agent-teams`, or a captain + durable members with dependency-aware tasks.

This is **not** the DeepSeek Harness Cordis plugin `@nanmicoder/dsh-agent-teams`. That package targets DSH (`dsh plugin …`) and stays on the H6 skip-list as `agentTeamsRuntime`. Rox maps the same *product idea* onto existing tools plus a workspace-local state store.

## When the flag is off

If Appearance → Workbench → **Agent Teams** (`workbench.harness.agentTeams`) is off, tell the user to enable it, then continue. Do not invent a second orchestrator UI. The durable store module itself does not flip the flag (default remains **false**).

## Durable state (`.agent-teams/`)

Persist roster + mailbox pointers under the **workspace** root (not Cordis, not `~/.craft-agent` by default):

```
<workspace>/.agent-teams/<teamId>/
  team.json                 # roster, tasks, captainSessionId
  inbox/captain.jsonl       # captain mailbox
  inbox/<member>.jsonl      # member mailbox
```

Runtime API: session tool `agent_teams` (wraps `AgentTeamsStore` under the project `.agent-teams/`). Do not import the Node module from the chat; call the tool.

- `action: create` / `add_member` / `set_member_session` after `spawn_session`
- `action: upsert_task` for DAG + status (`pending → claimed → in_progress → completed | failed | cancelled`)
- `action: append_mailbox` / `read_mailbox` alongside `send_agent_message` (disk truth + live message)
- `action: resume` to restore roster after restart; `action: archive` when done

Do **not** invent a Timeline surface or a live inspector DAG panel in this skill turn.

## Captain protocol (this session is captain)

1. Restate the goal and propose a **staged plan**: roster (roles) + task DAG (dependencies). Do **not** spawn members until the user approves (or they explicitly say to run immediately). Optionally `agent_teams` `action: create` with `phase: staged` so the plan is durable.
2. After approval, create members with `spawn_session` (one session per member). Prefer clear labels such as `agent-teams`, `role:<name>`, `team:<short-id>`. Call `add_member` / `set_member_session` so `team.json` holds session ids.
3. Give each member a focused prompt: role, assigned tasks, acceptance criteria, path to `.agent-teams/<teamId>/`, and instruction to report back via `send_agent_message` (and optionally `append_mailbox`).
4. Track tasks in `team.json` via `upsert_task` (and chat). States: `pending → claimed → in_progress → completed | failed | cancelled`.
5. Enforce dependencies: do not assign or claim a task until its dependencies are completed (`upsert_task` rejects early claims).
6. Coordinate with `send_agent_message` (live) + `append_mailbox` (durable). Captain consolidates; members may message each other when useful.
7. When done, summarize results in this chat, `action: archive`, and stop spawning. Prefer archive over delete unless the user asks. Use `action: resume` after a restart.

## Tool mapping (DSH plugin → Rox)

| DSH coordination tool | Rox equivalent |
| --- | --- |
| `agent_teams_create` | `agent_teams` `action: create` (this session as captain) |
| `agent_teams_add_member` | `spawn_session` + `add_member` / `set_member_session` |
| `agent_teams_remove_member` | Stop assigning; mark member `removed` / archive label |
| `agent_teams_create_task` | `agent_teams` `action: upsert_task` (new) |
| `agent_teams_claim_task` / `update_task` / `reassign_task` | `upsert_task` + `send_agent_message` |
| `agent_teams_send_message` | `send_agent_message` + `append_mailbox` |
| `agent_teams_status` | `action: status` + `list_sessions` |
| `agent_teams_resume` / `delete` | `action: resume` or `action: archive` |

## Hard rules

- One captain (this session) leads one active team at a time.
- Do **not** install or require Cordis / `dsh-cordis` / npm `@nanmicoder/dsh-agent-teams` inside Rox.
- Prefer `SessionFanOutSheet` / existing fan-out only when the user wants simple parallel replicas — Agent Teams is role + DAG oriented.
- Keep harness flags default-safe: never assume Agent Teams is enabled; never set the flag on behalf of the user.
- Do not invent a Timeline surface or a second workflow engine.
