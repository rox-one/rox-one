# WP-48: canonical release license audit

Source of truth: `plans/macro-integration/work-packages.json`, WP-48. This slice adds `audit.releaseLicense` to the existing workspace authority. It audits host-registered final bytes and persists the genuine checker result. `review_required` is a valid audit result; it is not permission to publish. No qualified reviewer, approval or legal clearance is manufactured.

## Contract and ownership

- Root integrates source, migrations, builds and native verification. License implementation proposals and isolated verification are owned by the WP-48 worker; an independent worker repeats corruption controls.
- HTTP: `POST /v1/workspaces/{workspaceId}/commands/audit.releaseLicense`; WS: `domain.audit.releaseLicense`. The existing V2 command envelope contains exact `artifactDigest`, `sbomDigest`, and `decisionManifest` references, an idempotency key and mandatory expected revision.
- Reads use existing authenticated `domain.license.list/get/events` and matching HTTP routes. All routes use the real canonical Actor, persisted live session and current workspace membership. Request bodies never select Actor, reviewer, executable, filesystem path or authority.
- This foundation explicitly requires the current workspace owner and persisted Resource read/write/action grants. It does not implement WP-03 generic grant delegation. Local `allow-all` and the Settings device-config grant do not override these server permissions.
- The new Resource response guard runs after transport identity revalidation, before serialization. WS reuses an optional trusted `RpcHandlerOptions.beforeResponse`; HTTP uses its composition-only guard. Both check current session, membership and Resource READ in PostgreSQL. The service lifecycle counts accepted outbound guard I/O before pool closure.

## Trusted inputs and real execution

`licenseRegistryPath` is an optional protected host configuration path in the existing service config. Enabling it selects the license migration and the four canonical channels. The registry has explicit owned, regular, bounded inputs and rejects symlink ancestors. It binds final artifact, build receipt, lock, review manifest, notices, checker source modules and the exact Bun binary by SHA-256. Client command references must match this registry.

The actual trusted `generate-sbom.ts check` process runs with fixed arguments from those registered inputs. Exit 1 preserves its real review-required findings; exit 0 requires its accepted exact audit result. Other exit states and byte drift fail with redacted provider errors. Final artifact and trusted input hashes are checked before and after execution. The temporary private audit file is removed afterward.

Human review is separate: authentic trusted reviewer inputs must cover the exact artifact, notices, origins, build flags and component contribution scopes. The CLI/registry does not turn a producer claim into an approval. Registry attribution, runtime byte evidence and source lineage are independent prerequisites; baseline notices alone cannot clear bundled dependencies.

## Persistence and proof

One transaction performs current authorization/CAS, checker execution, a fresh post-I/O authorization check, aggregate change, `audit.license_reviewed` in the existing outbox, and the original canonical receipt. Receipt replay rechecks trusted immutable Resource metadata and independent event actor/cause/correlation/revision/epoch/sequence/time/payload and receipt columns. Coherent changes to JSON and its unkeyed digest cannot substitute for this proof.

GET and LIST bind projected evidence, audit digest, time, revision and watermark to the independently retained receipt/event. License activity and the internal existing inbox share the same real PostgreSQL/registry event verifier. Ordinary project replay explicitly excludes license events; workspace membership alone cannot reveal a Resource-private audit. Inbox effect, dedup row and projection watermark remain atomic.

## Native surface

The existing Server Settings page contains a RU evidence panel before the optional local device-config read. It displays registered artifact, SBOM/build/review/checker hashes, component scopes, genuine findings and current audit state. It uses existing workspace authority login/connection generation. Loading, empty, denied, unavailable, queued, uncertain and independently readback-verified states are distinct. Private rows and receipts are retracted on scope/connection changes. No “approve” action is invented.

The existing main-owned encrypted intent slot now accepts a discriminated V2 license operation alongside its unchanged legacy Project intent. There is still one slot, one credential backend and one authenticated scope binding. Project and license payloads are never coerced into each other. Conflicting operations and unknown formats are preserved and rejected. Storage happens before delivery; explicit retry retains the original IDs, payload and key, reauthenticates, verifies the canonical receipt and reads it back before removing the intent. A lost reply remains uncertain. Cancellation deletes only a matching local intent and does not roll back a server effect.

## Applicable breadth and limits

License evidence is host-registered release metadata, not a content document. There is no native editing, sharing, mention, attachment or content search surface for it. Activity uses the reference-only event cursor; no additional notification or user system is added. Canonical HTTP/WS is also the agent-facing access path. A separate MCP tool is not invented.

Command/cause/correlation, aggregate revision, policy epoch and watermark are durable reference fields. Existing inbox observability records actual failure/retry/dedup counters without raw payloads or identity labels. The bootstrap outbox has no durable generic DLQ primitive; implementing one belongs to the real WP-04 framework/host consumer policy and is a remaining normative dependency. A fabricated DLQ counter is not emitted.

Native pixels, keyboard operation, two-account denied state and application reload require root's actual Electron acceptance after integration. Source/tests do not replace that gate. Publication remains blocked wherever real scoped review or complete notices are absent.
