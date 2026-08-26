# M4 ExecutionPolicy + leases

## 1. Title and Metadata

| Field | Value |
| --- | --- |
| Author | Operator session 2026-08-26 (M4 policy / leases) |
| Date | 2026-08-26 |
| Status | **In Review** |
| Reviewers | Product owner (Mark) |
| Parent | [architecture.md](./architecture.md) (Accepted, M0) §3.2, §9, §10, §18–§20, §22 |
| Related | [g1-decision.md](./g1-decision.md); [m3-first-slice.md](./m3-first-slice.md) (Approved); fabric [05-broker-and-leases.md](../2026-08-11-rox-connection-fabric/05-broker-and-leases.md) |
| Ground | `rox-one/rox-one` `origin/main` @ `4e95655` (merged M3 plan) |
| Milestone | Architecture §20 M4 — Policy + leases; PR #69 adapt onto `fabric*`; exit **G6** |
| Reviewers note | Product code MUST NOT start until this spec is **Approved**. This document is the contract, not an implementation. |

## 2. Context

M3 proved a first-class local terminal: control on RPC, bytes off `WsRpcServer`, fence epoch, flags default off, no WorkItem. It did **not** close G6. Architecture invariant 12 is still open: new workflow / unattended paths MUST carry an explicit `ExecutionPolicy`. Implicit `allow-all` is forbidden.

Two different “lease” ideas already exist and MUST stay distinct. `CredentialLease` is the connection-fabric broker handle: a bounded, purpose-scoped authorization to *use* a secret without ever seeing it. `ResourceControlLease` is a fencing record: who currently commands a terminal / browser / run, and at which monotonic epoch. Collapsing them into one `Lease` type would mix secret authority with input ownership and break G5.

GRANT exists so a workspace can authorize a consumer for an action on a `CredentialRef`. Architecture §22 requires M4 security tests that **GRANT rejects secret fields**. The renderer, URL, logs, crash reports, prompts, and JSON-RPC MUST never receive tokens, passwords, API keys, or raw payloads. Fabric already forbids a public `getSecret(ref)`. M4 binds that rule to the execution coordinator: policy decides *whether* a run may use brokered secrets; the broker decides *how* they are delivered; GRANT never carries the secret itself.

Leases exist because TTL-only control is a rejected design, and because copying a secret into the PTY environment or the renderer is irreversible. A grant that accepts a `token` field would become a covert `getSecret`. A start path that omits `policyId` would become implicit allow-all.

Parent import policy (architecture §28 / session `WORK-PLAN.md`): SKIP the parent 81-commit merge; ADAPT PR #69 convert/unbind onto existing `fabric*` RPCs after M3; do not introduce `workgraph.*` or Turso as a side effect.

Success: all AC-* below are testable with `execution.policy.v1` default **false**. Failure to implement PR #69 in this milestone does not block writing this spec; the adapt contract is in OS / FR-10.

## 3. Functional Requirements

- **FR-1** The system MUST introduce a first-class `ExecutionPolicy` type whose fields are exactly those locked in architecture §3.2: `id`, `filesystem` (`'none' \| 'workspace' \| 'allowlist'`), `network` (`'none' \| 'allowlist'`), `process` (`'none' \| 'allowlist'`), `secrets` (`'none' \| 'brokered'`), `capabilities: string[]`, and optional `timeMs`, `tokenBudget`, `costBudget`, `artifactMaxBytes`. The type MUST NOT add an `'all'` / `'allow-all'` member on any enum.
- **FR-2** Every new workflow, unattended, or coordinator `start` / `admit` path MUST carry an explicit `policyId` that resolves to a stored `ExecutionPolicy`. Missing, unknown, or unreadable `policyId` MUST deny admission. Implicit allow-all MUST NOT be synthesized.
- **FR-3** The system MUST introduce a first-class `CredentialLease` type that is metadata only: at least `id` (`CredentialLeaseId`) and `connectionId`. Renderer-visible and RPC-visible instances MUST NOT contain secret material, a `payload` field, a raw token, or a provider secret value.
- **FR-4** The system MUST introduce a first-class `ResourceControlLease` type with fields `id`, `resource` (`'terminal' \| 'browser' \| 'run'`), `resourceId`, `holder` (`ClientDeviceId`), and `epoch` (`FenceEpoch`, unsigned integer starting at 1, monotonic per resource). Control ownership MUST use this record, not a TTL-only timer.
- **FR-5** `CredentialLease` and `ResourceControlLease` MUST remain distinct named types. A single overloaded `Lease` / `Run` / `Host` type MUST NOT be introduced. `CredentialLeaseId` MUST NOT be interchangeable with `ResourceControlLeaseId`.
- **FR-6** GRANT-style APIs (`AccessGrant` create / update / IPC equivalent, including any `fabric*` grant operation used by execution) MUST reject any request that includes a secret field. Secret field names include at least: `token`, `secret`, `password`, `apiKey`, `api_key`, `privateKey`, `private_key`, `payload`, `value`, `raw`, `credential`, `accessToken`, `refreshToken`. Rejection MUST occur before persistence and before broker resolution.
- **FR-7** Feature flag `execution.policy.v1` MUST default to `false`. Missing, malformed, or non-boolean values MUST behave as `false`. When the flag is `false`, M4 MUST NOT admit new workflow / unattended start paths and MUST NOT change pre-M4 Session / terminal / browser behavior.
- **FR-8** When `execution.policy.v1` is `true`, `ExecutionCoordinator.start` / `admit` MUST fail closed on: missing policy (FR-2), policy that cannot be evaluated, expired or revoked `CredentialLease` when `secrets === 'brokered'`, or a `ResourceControlLease` epoch mismatch. Fail-closed MUST deny the command; it MUST NOT continue with a weaker policy.
- **FR-9** Secrets for an admitted run MUST be `'none'` or `'brokered'`. `'brokered'` MUST obtain a `CredentialLease` through `CredentialBroker.acquireLease` (fabric). The coordinator MUST NOT expose `getSecret`, MUST NOT copy secret values into renderer state, and MUST NOT export raw secrets into the PTY environment except brokered, allowlisted variable *names* whose values are injected by the broker on the host side.
- **FR-10** Parent PR #69 convert / unbind MUST be specified and later adapted onto existing `fabric*` operations, not `workgraph.*`. `LOCAL_ONLY` MUST remain a routing class, not an authorization decision. WorkGraph-style remote advertisement of local channels MUST NOT be copied. PTY bytes MUST NOT be added to `WsRpcServer` / `serializeEnvelope` as a side effect of this milestone.

## 4. Non-Functional Requirements

- **NFR-1 Fail-closed.** Missing, malformed, expired, revoked, unknown, or ambiguous policy / grant / lease / flag state MUST deny. The system MUST NOT degrade to allow-all, to a cached secret value, or to “best effort” control with a stale epoch.
- **NFR-2 No tokens in the renderer.** `CredentialLease`, GRANT responses, control RPC, activity, audit, logs, crash reports, prompts, and URL / layout snapshots MUST NOT contain tokens, passwords, API keys, private keys, or secret payloads. Error bodies MAY name a rejected *field* and MUST NOT echo its value.
- **NFR-3 Compatibility.** With `execution.policy.v1` false (the default), existing Session, browser, cloud-run, and M3 terminal routes MUST keep current behavior. Flags `workbench.terminal.v1` and `execution.coordinator.v1` stay independent and default false.
- **NFR-4 Transport isolation.** M4 MUST NOT require `WsRpcServer` to accept a new payload type for PTY or secret bytes.
- **NFR-5 Naming honesty.** Types compile as distinct names (G5). Overloading `WorkflowRun`, `CloudRun`, `WorkItem`, or a generic `Lease` is a release blocker.
- **NFR-6 Performance.** This milestone MUST NOT invent latency or size percentages. Packaged-build numbers remain G7 / M6.
- **NFR-7 Audit hygiene.** Audit events for grant, lease acquire / revoke, and admit / deny MUST record metadata and digests only (ids, policyId, connectionId, epoch, reason codes). They MUST NOT store prompts, tokens, absolute host paths, or artifact bytes.

## 5. Acceptance Criteria

### AC-1 ExecutionPolicy shape (FR-1, NFR-5)

Given the M4 type surface  
When `ExecutionPolicy` is inspected  
Then it has `id`, `filesystem`, `network`, `process`, `secrets`, `capabilities`  
And `filesystem` is only `'none' | 'workspace' | 'allowlist'`  
And `network` and `process` are only `'none' | 'allowlist'`  
And `secrets` is only `'none' | 'brokered'`  
And no enum member named `'all'` or `'allow-all'` exists.

### AC-2 Explicit policy on new start (FR-2, FR-8, NFR-1)

Given `execution.policy.v1 === true`  
When `ExecutionCoordinator.start` / `admit` is invoked without `policyId`, or with an unknown `policyId`  
Then the call is denied with a stable error code (`POLICY_REQUIRED` or `POLICY_UNKNOWN`)  
And no `ExecutionRun` is created  
And no implicit allow-all policy is stored or applied.

### AC-3 CredentialLease is metadata only (FR-3, FR-9, NFR-2)

Given a brokered secret exists for `connectionId` `c1`  
When a renderer or RPC client reads the `CredentialLease`  
Then the object includes `id` and `connectionId`  
And it has no `payload`, `token`, `secret`, `password`, or raw credential value  
And a public `getSecret` API is not present on the coordinator or GRANT surface.

### AC-4 ResourceControlLease fencing (FR-4, FR-8, NFR-1)

Given controller A holds a `ResourceControlLease` on terminal `t1` at epoch `n`  
When controller B is granted control  
Then a new or updated `ResourceControlLease` has `epoch === n + 1` and `holder === B`  
And a mutating command from A carrying epoch `n` is rejected (`FENCE_MISMATCH`)  
And the resource does not apply A's command.

### AC-5 Distinct lease types (FR-5, NFR-5)

Given the M4 type surface  
When `CredentialLease`, `ResourceControlLease`, `ExecutionRun`, `WorkflowRun`, and `CloudRun` are compared  
Then they are distinct named types  
And `CredentialLeaseId` is not assignable to `ResourceControlLeaseId`  
And no type named only `Lease` is the exported contract for both secret and control.

### AC-6 GRANT rejects secret fields (FR-6, NFR-1, NFR-2)

Given a GRANT create / update request that is otherwise valid  
When it includes any secret field (`token`, `secret`, `password`, `apiKey`, `api_key`, `privateKey`, `private_key`, `payload`, `value`, `raw`, `credential`, `accessToken`, `refreshToken`)  
Then the API rejects the request before persistence  
And the error code is `SECRET_FIELD_REJECTED`  
And the error names the field but does not echo its value  
And no `AccessGrant` and no `CredentialLease` is created.

### AC-7 Flag default false (FR-7, NFR-3)

Given a fresh profile with no `execution.policy.v1` key, or with a malformed / non-boolean value  
When the app starts  
Then the flag behaves as `false`  
And new workflow / unattended start paths are not admitted  
And existing Session / browser / M3 terminal behavior is unchanged  
And no PTY is spawned by M4 itself.

### AC-8 Brokered secrets stay on the host (FR-8, FR-9, FR-10, NFR-2, NFR-4, NFR-7)

Given `execution.policy.v1 === true` and a policy with `secrets: 'brokered'`  
When the run is admitted and a lease is acquired  
Then `CredentialBroker.acquireLease` is the only secret-adjacent call  
And RPC / renderer traces contain lease id and `connectionId` only  
And `serializeEnvelope` / `WsRpcServer` payloads do not gain PTY bytes or secret bytes  
And convert / unbind uses `fabric*` names, not `workgraph.*`.

## 6. Edge Cases

- **EC-1** Flag key absent, `null`, `"true"` string, `1`, or `{}` → treat as `false` (FR-7, NFR-1).
- **EC-2** `policyId` present but document missing, unreadable, or wrong type → `POLICY_UNKNOWN`; no run (FR-2).
- **EC-3** Policy `secrets: 'brokered'` and broker deny (unknown ref, missing grant, expired provider, unsupported delivery) → admit fails closed; no host-side secret injection (FR-8, FR-9).
- **EC-4** Policy `secrets: 'none'` and a caller still requests a credential lease → deny; do not acquire (FR-9).
- **EC-5** GRANT request with a secret field nested under `metadata`, `locator`, or unknown extra keys → `SECRET_FIELD_REJECTED` (FR-6). Unknown non-secret extra keys MUST also fail closed (reject), not be silently stored.
- **EC-6** Two `take_control` calls on the same resource: epochs are strictly increasing; the loser is `FENCE_MISMATCH` (FR-4).
- **EC-7** Expired or revoked `CredentialLease` used after admit → subsequent brokered use is denied; the run does not receive a refreshed secret without a new `acquireLease` (FR-8).
- **EC-8** Caller invokes `workgraph.*` convert / unbind → rejected; documented adapt path is `fabric*` only (FR-10).
- **EC-9** `LOCAL_ONLY` routing label presented as an authorization grant → MUST NOT bypass `ExecutionPolicy` or GRANT (FR-10).
- **EC-10** Audit / log adapter asked to record a secret value → omit / redact; persist reason code only (NFR-7).
- **EC-11** Desktop restart (D2) MUST NOT resurrect a `CredentialLease` payload from disk. Control leases MAY be restored only as metadata + epoch; secrets require a new broker decision.
- **EC-12** Concurrent GRANT with a secret field and a clean GRANT for the same consumer → secret request is rejected; the clean request is evaluated independently (no partial merge of secret fields).

## 7. API Contracts

No public HTTP `/api/policy` or `/api/grant`. Operations below are IPC / in-process contracts (same notation as fabric: names, not network routes). Success and error shapes are normative.

```ts
export type ExecutionPolicyId = string
export type CredentialLeaseId = string
export type ResourceControlLeaseId = string
export type FenceEpoch = number // unsigned, monotonic, starts at 1
export type ClientDeviceId = string

export interface ExecutionPolicy {
  id: ExecutionPolicyId
  filesystem: 'none' | 'workspace' | 'allowlist'
  network: 'none' | 'allowlist'
  process: 'none' | 'allowlist'
  secrets: 'none' | 'brokered'
  capabilities: string[]
  timeMs?: number
  tokenBudget?: number
  costBudget?: number
  artifactMaxBytes?: number
}

export interface CredentialLease {
  id: CredentialLeaseId
  connectionId: string
  // metadata only — MUST NOT add payload / token / secret / password
  credentialRefId?: string
  purpose?: string
  action?: string
  resources?: readonly string[]
  audience?: string
  issuedAt?: number
  expiresAt?: number
  status?: 'active' | 'revoked' | 'expired' | 'used' | 'denied'
}

export interface ResourceControlLease {
  id: ResourceControlLeaseId
  resource: 'terminal' | 'browser' | 'run'
  resourceId: string
  holder: ClientDeviceId
  epoch: FenceEpoch
}

export interface StartExecution {
  commandId: string
  hostId: string
  environmentId: string
  policyId: ExecutionPolicyId // required on new workflow / unattended paths
  sessionId?: string
  workItemId?: string // optional; MUST NOT be required
}

export interface GrantRequest {
  workspaceId: string
  consumerId: string
  credentialRefId: string // opaque cred_*
  actions: readonly string[]
  resources: readonly string[]
  expiresAt?: number
  // MUST NOT: token, secret, password, apiKey, api_key, privateKey,
  // private_key, payload, value, raw, credential, accessToken, refreshToken
}

export interface GrantSuccess {
  id: string
  status: 'active'
}

export interface PolicyError {
  error:
    | 'POLICY_REQUIRED'
    | 'POLICY_UNKNOWN'
    | 'POLICY_DENIED'
    | 'LEASE_DENIED'
    | 'LEASE_EXPIRED'
    | 'FENCE_MISMATCH'
    | 'SECRET_FIELD_REJECTED'
    | 'FLAG_DISABLED'
    | 'FABRIC_REQUIRED'
  message: string
  field?: string // name only; MUST NOT be the secret value
}

export interface ExecutionCoordinatorPolicy {
  start(cmd: StartExecution): Promise<ExecutionRun | PolicyError>
  admit(cmd: StartExecution): Promise<ExecutionRun | PolicyError>
}
```

Error mapping:

| Condition | Code | HTTP-equivalent (if ever exposed) |
| --- | --- | --- |
| Flag false on a new unattended path | `FLAG_DISABLED` | 403 |
| Missing `policyId` | `POLICY_REQUIRED` | 400 |
| Unknown / malformed policy | `POLICY_UNKNOWN` | 400 |
| Policy evaluated and denied | `POLICY_DENIED` | 403 |
| Broker / grant deny | `LEASE_DENIED` | 403 |
| Lease expired or revoked | `LEASE_EXPIRED` | 403 |
| Stale control epoch | `FENCE_MISMATCH` | 409 |
| GRANT contained a secret field | `SECRET_FIELD_REJECTED` | 400 |
| `workgraph.*` used instead of `fabric*` | `FABRIC_REQUIRED` | 400 |

A public `getSecret(ref)` MUST NOT be added. `acquireLease` remains the fabric normative operation.

## 8. Data Models

| Entity | Field | Type | Constraints |
| --- | --- | --- | --- |
| ExecutionPolicy | `id` | string | PK, immutable |
| ExecutionPolicy | `filesystem` | enum | `none` \| `workspace` \| `allowlist` only |
| ExecutionPolicy | `network` | enum | `none` \| `allowlist` only |
| ExecutionPolicy | `process` | enum | `none` \| `allowlist` only |
| ExecutionPolicy | `secrets` | enum | `none` \| `brokered` only |
| ExecutionPolicy | `capabilities` | string[] | Allowlist; empty means none |
| ExecutionPolicy | `timeMs` | number? | If set, > 0 |
| ExecutionPolicy | `tokenBudget` | number? | If set, > 0; not a secret |
| ExecutionPolicy | `costBudget` | number? | If set, > 0 |
| ExecutionPolicy | `artifactMaxBytes` | number? | If set, > 0 |
| ExecutionRun | `policyId` | string | Required on new start paths; FK to ExecutionPolicy |
| CredentialLease | `id` | string | PK; never a secret |
| CredentialLease | `connectionId` | string | Required; not a secret value |
| CredentialLease | secret payload | — | **Forbidden** in this model and in RPC |
| ResourceControlLease | `id` | string | PK |
| ResourceControlLease | `resource` | enum | `terminal` \| `browser` \| `run` |
| ResourceControlLease | `resourceId` | string | Target id |
| ResourceControlLease | `holder` | string | ClientDeviceId |
| ResourceControlLease | `epoch` | number | ≥ 1, monotonic per resource |
| AccessGrant | `id` | string | PK |
| AccessGrant | `credentialRefId` | string | Opaque `cred_*` |
| AccessGrant | actions / resources | string[] | No secret values |
| Flag | `execution.policy.v1` | boolean | Default **false**; fail-closed parse |
| Flag | `workbench.terminal.v1` | boolean | Unchanged; default false |
| Flag | `execution.coordinator.v1` | boolean | Unchanged; default false |

No WorkItem table. No Turso / WorkGraph schema. No parent-81 merge. Indexes: `ExecutionPolicy.id`; `ResourceControlLease (resource, resourceId)` unique current row; `CredentialLease.id`.

## 9. Out of Scope

- **OS-1** Product implementation of this spec — blocked until Status is **Approved**.
- **OS-2** WorkItem UI / kernel and parent WB-ADR-000 first vertical — M8. WorkItem MUST NOT become required for terminals or policy admit.
- **OS-3** Parent 81-commit merge, WorkGraph, Turso, origin PR #8, OSS `v0.12.0` — import policy SKIP.
- **OS-4** Implementing parent PR #69 in this document. M4 specifies the adapt target (`fabric*`, not `workgraph.*`); the code change is a follow-on after Approval.
- **OS-5** SSH, relay, Web, iOS, CLI attach, cross-host handoff — M7.
- **OS-6** Packaged-build performance targets — G7 / M6.
- **OS-7** Choosing or revisiting the PTY implementation — G1 already recorded in `g1-decision.md` (`native-crate`). This spec MUST NOT reopen G1.
- **OS-8** Putting PTY bytes on `WsRpcServer` / `serializeEnvelope` — forbidden, not deferred.
- **OS-9** A public `getSecret` API, Infisical Web UI, or desktop PostgreSQL / Redis — fabric OS; still forbidden.
- **OS-10** Replacing URL / panel-stack SoT or merging Workbench hosts — ADR-0001.
- **OS-11** Encryption-at-rest for a later graph — architecture §29, still gated.
- **OS-12** Growing `SessionManager` leftover `taskSlug` / `taskRunId` / `taskNodeId` fields — forbidden.
- **OS-13** TTL-only control leases as a substitute for `ResourceControlLease.epoch` — rejected design (architecture §24).

---

## Traceability

| AC | FR / NFR |
| --- | --- |
| AC-1 | FR-1, NFR-5 |
| AC-2 | FR-2, FR-8, NFR-1 |
| AC-3 | FR-3, FR-9, NFR-2 |
| AC-4 | FR-4, FR-8, NFR-1 |
| AC-5 | FR-5, NFR-5 |
| AC-6 | FR-6, NFR-1, NFR-2 |
| AC-7 | FR-7, NFR-3 |
| AC-8 | FR-8, FR-9, FR-10, NFR-2, NFR-4, NFR-7 |

| FR | AC | EC |
| --- | --- | --- |
| FR-1 | AC-1 | — |
| FR-2 | AC-2 | EC-2 |
| FR-3 | AC-3 | EC-11 |
| FR-4 | AC-4 | EC-6 |
| FR-5 | AC-5 | — |
| FR-6 | AC-6 | EC-5, EC-12 |
| FR-7 | AC-7 | EC-1 |
| FR-8 | AC-2, AC-4, AC-8 | EC-3, EC-7 |
| FR-9 | AC-3, AC-8 | EC-3, EC-4 |
| FR-10 | AC-8 | EC-8, EC-9 |

Every FR has at least one AC. Every AC references at least one FR or NFR.
