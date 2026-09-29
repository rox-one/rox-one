# Macro → ROX: executive summary

Product уточнение Revision3: [PRD](product/PRD.md), [UI/UX](product/UI-UX-CONTRACT.md), [61target screens/219controls и recheck](24-reverification-and-product-spec.md), [52cloud execution packets](../../cloud/macro-integration/README.md). Это конкретное размещение и contract будущей реализации; architecture Revision2 ниже сохраняется.

Исследование фиксирует **Macro `c966b79d40798c6c726a3b15fe90517941fc6e61`** и **ROX `f63294ba4fffa7238b46b24e918925a313ad0b12`**. Результат — архитектура **Revision 2**, 24 тематических документа, 38 семейств поверхностей, 162 capability rows и 52 implementation work packages. Это анализ текущего кода и план реализации; production feature parity не заявляется. Evidence registries и source diagrams позволяют проверить выводы по SHA, path, symbol и строкам.

## Что в Macro действительно нужно ROX

Compound workspace: документы, задачи, human messages/discussions, почта, CRM, календарные события, Calls и agent context связаны typed references. Особенно полезны общие MessageParent, document CRDT/WAL/awareness, property-backed Tasks, email-derived Company/Contact, provider calendar sync, Call архив и единственная attention/search инфраструктура. Macro сам имеет gaps: разные authority branches, best-effort workers и неполное indexing. Точные traces — [product map](01-macro-product-map.md), [architecture](02-macro-architecture.md), 07–17.

## Какие возможности ROX уже имеет

ROX — не пустой shell. Есть native Sessions, Projects, Pages, Notes, Tasks, Meetings, Memory, Sources, Skills, Automations, Connections; Context/Dossier/Inbox/Feed и другие contextual views. `Rox2EntityRef`, relations, external bindings, versioned result triad и surface context уже определены. Есть actual JMAP/Stalwart Mail и локальный MediaRecorder→ffmpeg/whisper.cpp→agent summary путь. Pages — HTML artifacts; Notes — Tiptap Markdown; personal tasks уже имеют recurrence/checklist/backlinks. [Current-state code evidence](03-rox-current-state.md).

## Главные gaps

Shared identity/authoritative per-resource ACL отсутствуют в текущем RPC контексте. Team sync — local-only; личные task IDs/TaskProject не совпадают с workspace ProjectConfig. Calendar production adapter unavailable; SFU rooms fail-closed. Для shared workspace нужны server command authority, durable sync/events, human messaging и CRM домены. Search/mentions/notifications/agents должны подключаться через общий контракт сразу, включая agent transcript provenance и sharing. [03](03-rox-current-state.md), [14](14-permissions-sharing.md), [review](architecture-review.md).

## Что можно интегрировать

Сохранить существующие destinations, native React shell/panels, Projects/cwd/assets, HTML Pages, Notes, recurring Tasks, agent runtimes/MCP pool, JMAP mail и local Meetings. Расширить Rox2Ref и registerExternalBinding, bridge legacy refs/IDs; Dossier становится Company/Contact contextual view. Общие обсуждения работают поверх единого Message primitive; runtime AgentSession transcript остаётся отдельным record с entity context. [Mapping matrix](04-surface-parity-matrix.md).

## Что следует перенести архитектурно, но переписать

Macro SolidJS компоненты не являются React components ROX. Переносить behavior/domain/interaction contracts; typed adapters и UI писать в существующем ROX. Macro Tasks → RoxTask; Initiative/legacy Project → explicit Project mapping. CRM inbound discovery от нового отправителя — **расширение**: Macro создаёт новые companies только на sent email. Root Macro `LICENSE.txt` — AGPLv3, `apps/web/LICENSE` — all rights reserved; literal copy требует scope review. [Domain model](05-domain-model.md), [licensing](18-licensing.md).

## Что требует отдельной инфраструктуры

Shared Postgres authority, sync WebSocket workers, durable jobs, object storage/asset proxy, LiveKit+TURN/egress и transcription pipeline. PostgreSQL outbox/inbox заменяет необходимость Kafka/SQS на старте; S3-compatible storage вместо обязательного AWS; self-host alternatives перечислены в [17](17-infrastructure.md). Gmail/Microsoft/IMAP/JMAP и Google Calendar остаются adapters с реальными provider receipts. Нет предположения, что email send гарантирован exactly-once.

## Какие primitives дают максимальный эффект

1. Rox2 registry/ref/alias + typed domain descriptor.
2. EntityLink/Mention + bounded authorized context resolver.
3. Authenticated principal/workspace + единый resource policy API.
4. Revisioned command/idempotency receipt + single-writer authority router.
5. Transactional outbox/consumer inbox + per-aggregate ordering.
6. Common Message/Thread/Discussion/Attachment.
7. CollaborativeDocument + durable WAL + policy fence + ephemeral presence.
8. Search/Memory provenance + current ACL filtering.
9. Notification/Activity/read-state policies.
10. ProviderConnection/intent receipts + domain AgentTool registry.

## Recommended target architecture

Native ROX UI → existing routing/SurfaceContext → extended Rox2 typed client → modular workspace authority → typed Postgres domain tables/ACL/outbox. Shared-mode client stores — projections/outbox; standalone personal mode retains explicit local authority. Independent sync/media workers scale separately. Initial CRDT WAL and policy live in same Postgres transaction authority; media/provider side effects use durable sagas. Entity descriptor registration activates common plumbing only after extractor/policy/agent/test conformance. [Revision 2](19-target-architecture.md).

## Critical path

Private shared Project bootstrap → registry/ACL → command/outbox → single-writer/revoke fences → editor binding spike → collaborative Page and Message→Task → Project context → Mail→CRM + Calendar + Calls branches → Company account view → integrated E2E. Every slice delivers a working user scenario; the machine DAG has explicit dependencies and migration/interface artifacts. [DAG](20-migration-dag.md), [52 packages](21-implementation-plan.md), [acceptance](22-test-plan.md).

## Самые опасные architectural traps

Duplicate task/project/document IDs; agent execution allow-all mistaken for ACL; legacy file/IPC writes bypassing shared authority; revoked content leaking through persisted AgentSession/viewer share; CRDT ACK before durable append; premature search consumer offsets; private mail shared by link; transcript rollup destroying evidence IDs; provider optimistic UI reported verified; second Solid UI/Macro application beside ROX. Independent review found four P0 and six P1 design issues; fixes are integrated into Revision 2 and WP-49–51. Remaining execution inputs have defaults and closure tests in [23](23-open-questions.md).
