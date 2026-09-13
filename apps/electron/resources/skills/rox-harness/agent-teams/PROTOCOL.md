# Agent Teams protocol (Rox)

Staged plan → user approve → `spawn_session` members → durable `.agent-teams/<teamId>/team.json` roster via `agent_teams` → dependency tasks → `send_agent_message` + `inbox/*.jsonl` → captain summary → `agent_teams` `archive`.

## State root

`<workspace>/.agent-teams/` via `AgentTeamsStore` (`@craft-agent/core/platform/agent-teams`).

Captain session owns roster, DAG, and archive. Members may update assigned tasks and their own mailbox; `from` must match the calling session. Foreign, removed, and path-alias identities are rejected. The session tool is `safeMode: block`.

Cordis UI / host routes from `@nanmicoder/dsh-agent-teams` remain **out of scope** (H6 `agentTeamsRuntime` skip-list). Use DSH desktop profile if you need the upstream activity panel. Rox does not ship a Timeline or inspector DAG in this follow-up.
