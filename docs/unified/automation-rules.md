# Domain automations (rules R1–R5)

Wave-1 contract for the Rox Unified programme (issue #1509, package **W1-12**;
owner module: `automation`). Full behaviour ships in package AUTO (#1529).

Sources of truth: TECH-SPEC §14 (contract, runtime, R1 details, observability),
DATA-MODEL §5.16 (`automation_rule`, `rule_execution`, idempotency keys, backoff),
DATA-MODEL §12 / `apps/workspace-service/migrations/515-automation-rules.sql`,
UI-SPEC §24 (Settings → «Автоматизации»; settings API only), PRD D-v2-3 / D-v2-4
and D-v2-8.

## What a rule is

A **domain rule** is a `domain_event` consumer — not an orchestrator, and not the
Automations canvas (#1096–#1100, out of scope). It declares its triggers,
conditions, idempotency key and ordered steps; every step is one ordinary command
dispatched through the W1-03 command bus, so ACL, `rule:*` rate limits, receipts
and the audit trail all apply.

```ts
// packages/core/src/automation/rule.ts
interface DomainRule<E extends DomainEvent = DomainEvent> {
  id: 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  triggers: readonly DomainEventType[]
  scope: 'workspace' | 'principal'
  targets(ctx: RuleCtx, event: E): Promise<readonly RuleTarget[]>   // one execution per target
  enabled(ctx: RuleCtx, event: E): Promise<boolean>                 // automation_rule (+ per-user)
  conditions(ctx: RuleCtx, event: E): Promise<SkipReason | null>
  key(ctx: RuleCtx, event: E): string                               // rule_execution.idempotency_key
  steps(ctx: RuleCtx, event: E): readonly RuleStep[] | Promise<readonly RuleStep[]>
}
```

`RuleStep` = `{name, commandId?, command: {type, payload, target?, authorityHint?}, actor: 'system' | {agentOf}, optional?}`.
The runtime stamps each step's envelope with `commandId = idempotencyKey + ':' + step.name`
(`command_receipt` dedupes), `correlationId = key` and the authority hint. Steps
with `actor: 'system'` run as `{principalId: subject, kind: 'system'}` (the
affected principal, TECH-SPEC §14.2 "on behalf of"); `{agentOf: p}` runs as p's
personal agent with `onBehalfOf: p`.

## Runtime

| Where | What |
|---|---|
| `apps/workspace-service/src/modules/rules/` | consumer group `rules` over the W1-03 relay + the `automation_rule` settings API |
| `packages/server-core/src/rules/` | the shared engine and the local in-process consumer (subscribes to the local post-commit event bus) |

Per committed event:

1. every rule whose `triggers` match: `targets` → `enabled` → `conditions`;
2. claim the `rule_execution` row (`INSERT … ON CONFLICT (idempotency_key) DO NOTHING`).
   An existing row resumes **from its first non-succeeded step**; steps already
   done are never repeated;
3. dispatch each remaining step; a failed required step follows the backoff
   schedule **1 min, 5 min, 30 min, 2 h** and the execution is `failed` after 4
   attempts. A failed **optional** step ends as `partially_succeeded`;
4. the plan of every step (command + payload + subject) is stored with the
   execution, so `resumePending()` can finish a job after a process restart
   without the triggering event.

Statuses: `running`, `succeeded`, `partially_succeeded`, `failed`, `skipped`
(the skip reason is stored as `skipped:<reason>`).

Observability (TECH-SPEC §14.4): `rule_executions_total{rule,status}`,
`rule_duplicates_prevented_total`, `rule_step_latency_ms{rule,step}` — fixed
labels only (`WorkspaceRulesRuntime#snapshot()`).

## The five rules

| Rule | Trigger | Owner | Key | Steps |
|---|---|---|---|---|
| **R1** meeting notes + prep task | `calendar.event_created`, `calendar.external_event_seen` (provider uid), `calendar.occurrence_upcoming` (per occurrence) | organiser (`for` param widens to all Rox attendees) | `R1:{event\|provider_uid}:{occurrence\|'single'}:{owner}` | `task_lists.ensure_system_list('backlog')` → `docs.ensure_daily_note` → `docs.create_meeting_notes` → `docs.append_daily_link` → `tasks.create` → 3 × `links.add` |
| **R2** member → General chat + agent | `people.member_added` | the joining member | `R2:{workspace}:{principal}` | `im.add_members` → `agents.provision_personal_agent` → optional `im.send_message` join card |
| **R3** account → agent DM + welcome | `identity.account_created` | the new member | `R3:{principal}` | `agents.provision_personal_agent` (same command id as R2) → `im.get_or_create_p2p` → optional `onboarding.seed_starter_content` → `im.send_message` welcome **as the agent** |
| **R4** invites → placeholders | `people.invitations_sent` | per email | `R4:{workspace}:{email}` | `identity.ensure_placeholder` → `people.add_workspace_member('invited')` → optional `im.add_members` → optional `notify.send_invite_email` |
| **R5** account → personal Drive | `identity.account_created` | the new member | `R5:{principal}` | `drive.provision` (1 TiB default, D-v2-8) → optional virtual folders |

**D-v2-3 / D-v2-4 (R1, approved by Mark 2026-10-08):** notes and the prep task
are created for the **organiser only**; all-day, declined (`rsvp=declined`), free
(`transparency=free`), cancelled and `#no-notes` events are skipped; the prep task
lands in the per-user system list «Бэклог» (`task_lists.ensure_system_list`,
`systemKey: 'backlog'`), never in the Things Inbox.

R1's daily link is one block with the deterministic id
`uuidv5(key + ':daily-link')` — re-runs update it in place instead of appending;
the daily note itself is deterministic too (`dailyNoteId(workspace, owner, date)`,
`packages/core/src/docs/daily.ts`, re-exported by the notes view).

**R2 and R3 share one personal agent**: both provision steps carry the same
`commandId` (`personalAgentCommandId(workspace, principal)`), so the second
dispatch answers `duplicate` instead of creating a second agent.

## Settings API (`automation.rules.v1`)

```
GET  /v1/workspaces/{ws}/automation/rules                  → { enabled, rules: [{ruleId, scope, enabled, params, source, updatedAt}] }
PUT  /v1/workspaces/{ws}/automation/rules/{ruleId}         → body {enabled?, params?} → the effective view
GET  /v1/workspaces/{ws}/automation/executions             → history (?ruleId=&status=&limit=)
POST /v1/workspaces/{ws}/automation/executions/{key}/retry → re-run the pending steps
```

R1 is per user (the row is `scope: 'principal'` for the caller); R2–R5 are
workspace-level and **admin-only** (`workspace_member.role ∈ {owner, admin}`).
Params are validated per rule (`R1`: `for`, `skipAllDay`, `skipKeywords`,
`listSystemKey`, `prepTaskTitlePrefix`; `R2`: `announce`, `joinCardTemplate`;
`R3`: `welcomeTemplate`, `handles`, `locale`; `R4`: `role`; `R5`: `quotaBytes`,
`folders`). The UI (Settings → «Автоматизации», UI-SPEC §24) is package AUTO;
this package ships the API shape and the strings.

## The flag

`automation.rules.v1` (`WORKBENCH_FLAG.automationRulesV1`, default **OFF**;
`CRAFT_FEATURE_AUTOMATION_RULES` is the explicit env override for tests). While it
is off:

- the local consumer installs **no** bus subscription and the workspace runtime
  plans no execution;
- the settings routes answer `404`;
- the automation command definitions report `flag_off` and dispatch nothing.

## Contract notes (wave 1)

- Commands bound here: `task_lists.ensure_system_list`, `notify.send_invite_email`
  (new, W1-12), plus the automation contract of `docs.ensure_daily_note` /
  `docs.append_daily_link` (deterministic ids, in-place daily link). All other
  step commands belong to their owner modules and are executed by the W1-06
  reference handlers until the wave-2 modules replace them.
- Trigger events are emitted by their owner modules (calendar, identity,
  contacts/ONB); the rules consume the documented payloads only.
- `packages/core/src/automation/__tests__/` covers the declarations,
  `packages/server-core/src/rules/__tests__/rules-e2e.test.ts` runs all five
  rules end to end on the reference handlers (3× replay with a failure injected
  at each step, zero duplicates), and `apps/workspace-service/test/rules.test.ts`
  covers the consumer group and the settings routes.