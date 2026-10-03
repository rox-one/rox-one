# Decisions, external dependencies и открытые проверки

Дата 2026-09-30; baseline ROX `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Решения ниже достаточно конкретны для реализации slices; открытые вопросы не служат остановкой всей работы.

| ID | Decision / reason | Verification or owner |
|---|---|---|
| LD-01 | Docs extends existing Notes/Page IDs, ToC/comments/views; one library | Source paths in06; RD-01/02 runtime |
| LD-02 | First content authority Markdown; optional new rich format explicit | Lossless format tests; migration epoch; no dual-write |
| LD-03 | Map+Outline same nested list; view geometry separate | LT-02–10, conversion preview/copy |
| LD-04 | Single aggregate CAS covers content/tree; stale epoch rejects | LT-07/09; Notes RPC adapter owner |
| LD-05 | Base projects native domains, CustomRecord for new data only | LT-25/26; initialpage+contentKind subtype schema |
| LD-06 | Personal Task source/owner scoped; workspace binding explicit | Two stores sameID negative control |
| LD-07 | Legacy checkbox formulas keep old meaning; native task counts separate | LT-27 |
| LD-08 | Shared ACL evaluator plus domain/field/record policy | LT-16/18/30/44; no agent bypass |
| LD-09 | Shared discussions/mentions/notifications; no second Notes comment DB | Migration visibility and anchors |
| LD-10 | Existing Automation graph/runtime extended; immutable versions/receipts | RA-01–09, LT-39–41 |
| LD-11 | Third-party Tanca/Seleam/Coze adapters first; no UI iframe product | Source/connection identity, scopes and terms check before integration |
| LD-12 | Original implementation from behavior; GPL/MPL/license discrepancies not ignored | Specific reused files/dependencies audit before copying |
| LD-13 | Lark conceptual entities not asserted proprietary DB | Evidence labels on all catalogs |
| LD-14 | Light/dark compact ROX style, thin keyboard focus; no forced Lark skin | Actual font/zoom/IME/reduced motion proof |
| LD-15 | Legacy Lark Favorites read-only notice distinct Docs Favorites/Flag | capture58; don't reproduce discontinued behavior as target requirement |

## Questions resolved by code rather than asking the human

The Next/MindNotes create menu is real Lark UI, but opening a new object could create persistent content. The audit used existing Docs; MindNotes interaction depth remains documented, not live-tested. Lark owner/subscriber task role docs conflict: compute effective role from server/source policy and verify with controlled actors, don't hardcode one old sentence.

ROX has heading outline/canvas/graph, not automatically Ideascape-style editable list outline. Native Notes engine CAS and RPC save differ; route all final writes through one tested boundary. Current `.base` equivalent is client config, not shared durable relational engine. Published source baseline does not include new reference docs: cloud preflight must resolve delivery commit/digest separately.

## External dependencies by slice

| Dependency | Required for | Before independent work | Exact completion signal |
|---|---|---|---|
| Shared cloud backend deployment/topology | multi-user Docs/Bases | local typed handlers/UI/proofs can proceed | actual endpoint/auth/storage configured and two-client recovery passes |
| Provider OAuth and test accounts | writable mail/calendar | provider-neutral schema/mocks remain scoped | scopes verified, remote ACK/readback with synthetic fixtures |
| Lark paid/role entitlement | validating gated Lark parity | documented source audit complete | authorized tenant role permits target screen; no installing apps for research |
| Tanca onboarding password | private HR views | adapter contracts/public guide complete | user completes credential setup; no agent-created password |
| AnyCross integration solution install | execution/configuration beyond gate | reference builder screenshot/docs + ROX engine audit complete | separately authorized installation, exact scope review and sandbox receipt |
| Legal/code-origin review | literal source reuse, Signature assurance claims | original behavior implementation can proceed | concrete approved file/dependency list and obligations; no blanket license conclusion |
| External media/maps/geocoding service | advanced media previews/geography | offline UI/export can proceed | configured provider/policy + actual safe preview test |

## Unverified scope retained explicitly

Full private Tanca HR, Coze authenticated authoring, DocuGenius processing, all Approval template forms, live media call quality/recording, Sheets formula/pivot semantics, Lark mobile gestures, hover timing, distributed database topology and actual API scopes for a specific tenant are not proven by this audit. Public documentation plus source-cited ROX changes cover design, not runtime entitlement.

Implementation should version unknown choices with measurable contracts. For instance formula function set initially typed subset; wider spreadsheet functions belong Sheet domain, not unrestricted Base eval. Table viewport limits/worker budgets measured with fixture sizes and runtime performance; initial limits configurable and visible. Business app semantics remain explicit schema over Approval/CustomRecord rather than universal “anything executes anywhere”.

## New scope: Code Intelligence

Последнее уточнение пользователя добавило OpenWiki/GitDiagram/repogrep-alternative/Groma в тот же design/plan package. Selected OpenWiki reference is `langchain-ai/openwiki` (explicit working assumption matching code-wiki purpose); other same-name projects not merged. [13](13-code-intelligence.md) фиксирует source SHAs/licenses/pipeline, [14](14-code-intelligence-ui.md) —12 screens and snapshot/evidence/job contracts. Publication should include separate baseline and delivered spec digest; no claim tools installed or jobs running.

Final source validation found the existing `packages/shared/src/code-intelligence` pack, including types/local-adapter/explainer/Syft/tests. Extend that pack; existing `types.ts` is serialized through the integration owner. Its recorded rejection of duplicate CodeWiki/DeepWiki daemons remains rationale; OpenWiki becomes an explicit on-demand provider decision with one reviewed artifact authority. Existing adapter tests executed **4 pass /0 fail /26 assertions** at the baseline, establishing bounded helper behavior only, not a Project UI, scanner deployment or provider integration.

## Workflow improvement review

Useful demonstrated corrections are incorporated into this project specification: differentiate native AX focus-only clicks/loading from loaded screens; preserve actual Rox2EntityRef wire fields; don't call shell escaping actor authorization; distinguish webhook retries from durable graph steps. Existing operator/playbooks already require evidence, ownership and source verification. No independently evaluated general prompt/skill candidate was established; global instructions/skills were not changed for this task.
