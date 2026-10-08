# Independent review of the recovered visual reference

This review inspected the four actual PNGs recovered from the authorized archive. The originals remain outside the repository; only their names and SHA-256 fingerprints are recorded here.

| Inspected reference | SHA-256 |
| --- | --- |
| `01-welcome.png` | `3a0b5c05726f66d73c654c36d526edae9c8cba8e744935212ea958803ffab0fd` |
| `02-tool-groups.png` | `c6bf7f65ad515e2e79bb1bea45f93913306024bc1fcc7db934190f958e37503d` |
| `03-discovery-overview.png` | `5e8812537c5522b040e0265abf0f91a02c81dfd09f28cadf4a13753f47e4fa20` |
| `04-group-details.png` | `bd2976a02f7dbaf2dcb53f09621cc647cdb7e226173d0c3b3cf27fcab367d3c8` |

## Structural comparison

The reference uses an adjacent chat and dotted canvas, rounded compact containers, slightly lighter group headers, chevrons, separated interior rows, and quiet secondary text. `02-tool-groups.png` and `04-group-details.png` show Tools, Sub-agents and Skills as row groups. `03-discovery-overview.png` adds an agent/instructions container and actual-looking environment branches. These are visual examples, not evidence that the reference's backend operations or numbers are real.

The integrated execution map keeps the chat beside the canvas, uses the required 42/58 initial split, a native React Flow dot background, 268 px event cards, semantic theme tokens, and a separate source inspector. The light screenshot has readable 13 px card titles and 12 px descriptions at normal canvas zoom. Timeline chronology and agent lanes are product requirements extending the reference; a static discovery configuration must not replace the observed execution history.

The recovered images exposed a material R03 gap: the old Context mode merely filtered event cards and did not provide the reference's row groups. Product commits `a2e973b54` and `2e302fb9b` address it with a separate Context presentation over existing runtime identities. The root agent is established only by an observed root `run.accepted` or `run.started` lifecycle event. An explicit selector scopes the configuration to one actual agent. Instructions, Memory, Skills, Tools, request/model/context and child-assignment rows come from that agent's recorded snapshot and observations. Missing snapshots stay unknown, including a child with no recorded context. Tool schemas/allowlists, observed invocations, loaded skills and applied skills retain distinct labels.

Group rows preserve the existing node and `sourceEventId`, `sourceAgentId`, and `contextSnapshotId` when provided. In the DOM these are exposed as `data-source-node-id`, `data-source-event-id`, `data-source-agent-id`, and `data-context-snapshot-id`. Selecting a row opens the existing authorized inspector; the groups introduce no runtime events, execution statuses, task authority, or model/tool calls. Headers have a chevron and actual row count; the first four rows and a bounded “More” action preserve source identities. Actual row statuses have both an icon and visible translated text. Schedule, trigger and channel rows appear only for reported bindings.

The new Context browser proof is **pending at this review commit**. W8 prepared independent light/dark cases for disclosure, row-to-source-inspector selection, exact root/child provenance, missing child snapshots and unchanged execution counters. Pure provenance tests passed: 4 tests, 25 assertions, exit 0. The new Context component also passed a scoped strict TypeScript check before the final small status-label change; the combined source gate remains with the coordinator.

## Product-specified departures

`01-welcome.png` uses the reference's blue mascot and recommendations below its input. The ROX contract explicitly requires the existing girl asset, a compact “Что сделаем сегодня?” heading and gray recommendations **above the lower composer**. The reviewed ROX welcome screenshot follows that contract. The existing composer, attachment controls and permission behavior remain the product's own UI. The reference's usage percentage, model branding, third-party dependencies and decorative statistics are not copied.

The environment diagram does not give a manually started chat a schedule or trigger. Provider-hidden instructions and unavailable measurements remain unavailable rather than being filled from the reference's prose or numbers. An overview of 200 compact cards is a stress overview, not evidence that 200 detailed cards are readable simultaneously.

## Catalog comparison and limits

The inspected repository media include `skills-light-1440.png`, `skills-dark-1440.png`, `integrations-light-1440.png`, and `integrations-dark-1440.png`. They have the product document's required pack cards plus individual-skills table, search/filter controls, and integration category sidebar plus connection cards. The integration captures distinguish unknown, disabled, failed and needs-authorization states instead of showing every source as Connected. Catalog read/write/readback behavior is covered by separate functional evidence, not by this visual review.

None of the four recovered PNGs depicts the Skills catalog or Integrations catalog. A direct screenshot-to-screenshot reference comparison for R25/catalog styling therefore cannot be claimed from this archive. The positive conclusion here is a structural comparison against product document 01, sections 10–11, and document 03, tasks T20–T21.

The existing `media/ROX-live-map-dark.png` is an earlier compact-zoom capture and must be replaced by W8's final normal-zoom dark browser capture before it is used as final readability evidence. Browser zoom at 200% remains unverified: a 650 px viewport test is not a browser-zoom test. This review does not certify an installed desktop platform.
