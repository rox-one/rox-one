# Ticket 13 — Live-credential first-turn E2E evidence

Date: 2026-08-13  
Branch: `rox/next-program-t13-live-run-7c33`  
Gate: `packages/shared/src/agent/live-turn-gate.ts`  
Runner log: [`13-live-e2e-gate.log`](./13-live-e2e-gate.log)  
Session log: [`13-live-e2e-session.jsonl`](./13-live-e2e-session.jsonl)  
Event log: [`13-live-e2e-events.jsonl`](./13-live-e2e-events.jsonl)  
Browser trace: `/opt/cursor/artifacts/ticket-13-live-turn-webui.mp4` (13 MB; not committed)

## Verdict

**VERIFIED — `claim: live-turn-verified`.**

`claimLiveTurnVerified` accepted the event log + browser trace. All five Wave 5 live-turn steps are VERIFIED. The API key was supplied only via process env / a 0600 file under `/tmp`. It is not in git.

## Environment (2026-08-13, this run)

| Check | Result |
|---|---|
| `ROX_API_KEY` | set (not committed; prefix `rox_`) |
| `GET https://api.rox.one/v1/models` | 200, 73 models |
| Seeded default `kimi-K3` | **403** `Model "kimi-K3" is not allowed for this API key` |
| Working completion models | `gpt-5.6-luna`, `gemini-2.5-flash-lite`, `llama-3.3-70b` |
| Live session model | `gpt-5.6-luna` (OMP `~/.omp/agent/models.yml` provisioned without writing the secret) |
| `omp` | 17.2.10 (`OMP_CLI_PATH` → toolchain) |
| Isolated config | `CRAFT_CONFIG_DIR=/tmp/rox-live-e2e-13/config` |
| Session | `260813-vivid-moon` in workspace `live-e2e` |

## Wave 5 steps

| Step | Result | Evidence |
|---|---|---|
| stream answer | **VERIFIED** | First turn assistant content `PONG`. Later `text_delta` `DONE` / `RETRY-DONE`. |
| host tool | **VERIFIED** | `mcp__session__call_llm` `tool_start` + `tool_result` `isError: false` after restart |
| MCP tool | **VERIFIED** | `mcp__echo__echo` result `echo:live-e2e` |
| permission prompt | **VERIFIED** | `permission_request` for `call_llm` and `echo` in `ask` mode |
| restart → restore | **VERIFIED** | Server SIGTERM + respawn; `sessions:get` returned the same id; retry turn ran on it |
| web login | **VERIFIED** | Browser: `http://127.0.0.1:9100/login` → session transcript visible |

## Bug found and fixed on this branch

Ask-mode Allow for OMP host/MCP tools was fail-closed. Host-tool prompts were typed `admin_approval` without a command hash, so `SessionManager.respondToPermission` sent them through `PrivilegedExecutionBroker` (`No pending privileged request found`) and denied the user Allow.

- First tools turn: `Denied by user` on `call_llm` and `echo` (bash `echo live-e2e-bash` still ran).
- Fix: `shouldBrokerGatePermission` only gates `admin_approval` **with** a command hash. Host-tool prompts now use type `mcp_mutation`.
- After restart: both tools succeeded.

## Gate output after claim

```
status: READY
claim: live-turn-verified
missingSecret: none
reason: Live first-turn E2E verified from log + browser trace.
steps:
  stream_answer: VERIFIED
  host_tool: VERIFIED
  mcp_tool: VERIFIED
  permission_prompt: VERIFIED
  restart_restore: VERIFIED
```

## Product leftover (not this ticket)

The seeded default model is still `kimi-K3`. This key cannot call it. First-run provision should pick a model the key can use, or the gateway should allow `kimi-K3` on Rox keys. Not flipped here.
