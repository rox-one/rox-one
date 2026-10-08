# Surface chrome, agent panel and cross-functional capabilities (W1-15, #1512)

Wave-1 contracts for the v2.1 pass: the per-surface left sidebar and top bar,
the `@rox` agent panel that lives on every surface, and the X-13…X-26
cross-functional capability entry points.

Spec: `docs/specs/2026-10-08-lark-operately-unified/` — TECH-SPEC §18, §19, §20;
UI-SPEC §25, §26, §27, §28; DATA-MODEL §5.18; PRD ADR-U19, ADR-U20, M24–M26.

No new tables, kinds or relations (DATA-MODEL §5.18). Everything here is
contracts and reference handlers: with the three flags OFF the shell renders
exactly as before.

## Layers

| Layer | Module | Responsibility |
|---|---|---|
| Chrome contract | `packages/core/src/platform/chrome.ts` | `SidebarSchema` / `TopBarSchema`, slot ids, counter providers, the common row context menu, the schema lint |
| Chrome layout | `apps/electron/src/renderer/platform/right-dock.ts` | the pure right-dock mode/width function (§18.4) |
| Agent panel | `packages/core/src/agent-panel/{context,session}.ts` | `SurfaceContext`, `AgentContextProvider`, the §18.3 privacy rules, the `agent-panel` session origin and the persisted UI state |
| Capabilities | `packages/core/src/xfn/*` | X-13…X-26 names, risk classes, the drop table, the reference handlers, `reminder.subjectRef` |
| Wire format | `packages/shared/src/xfn/schemas.ts` | zod schema of every X-13…X-26 entry point |
| Pin privacy | `packages/core/src/acl/rules/pin-private.ts` | pins are private to `created_by`; excluded from backlinks, search and activity |

## Flags

Three workbench flags, all `defaultValue: false`
(`packages/core/src/platform/workbench/flags.ts`):

| Flag | Gates |
|---|---|
| `agent.panel.v1` | the panel (session origin, context providers, right dock) |
| `workbench.chrome.surfaces.v1` | rendering the sidebar / top bar from the schemas |
| `xfn.capabilities.v1` | every X-13…X-26 entry point (capability discovery hides them) |

`packages/shared/src/feature-flags.ts` exposes the server-evaluated twins
(`isAgentPanelEnabled`, `isChromeSurfacesEnabled`, `isXfnCapabilitiesEnabled`)
with the same shape as `isEntitiesLinksEnabled`: the workbench flag is
authoritative, `CRAFT_FEATURE_*` is an explicit test override.

## Surface chrome (§19, UI-SPEC §26)

A surface package registers one `SurfaceChromeContribution` into W1-07's slot
`<surface>.chrome` — `chromeSlot()` builds the contribution, so the swap to the
real registration is one line. Contributing packages add sections and right-zone
items through the existing slot ids; they never add a second rail.

- `<surface>.chrome` — the schema (`{ sidebar?, topBar? }`);
- `<surface>.sidebar.<section>` — one sidebar section;
- `agent.context.<surface>` — one agent-context provider (§18.1).

`lintChromeCatalogue()` is the gate: right-zone order
(`filter · sort · search · presence · share · primary · more`, `@rox` appended
by the shell and never listed), left-zone order, exactly one center control,
unique ids, spec widths, `counter.<id>` provider names, footer and pinned kinds.
`packages/core/src/platform/__tests__/fixtures/surface-chrome.ts` is the
reference chrome for all 18 sidebars and 25 top bars of UI-SPEC §26.2 / §26.3;
the lint runs over it in `__tests__/w1-15-chrome.test.ts`.

Counters are queries registered as `counter.<id>` and pushed on the
`user.counters` topic (logical name) — on the wire that is W1-03's
`user:<principalId>` topic with the `counters.changed` event type, coalesced for
1 s. Counters above 99 render «99+» (`formatCounter`).

The common row context menu (`COMMON_ROW_CONTEXT_MENU`) is the §26.1 order; a
surface appends its own items through `SidebarSchema.contextMenu.extra` and
`buildRowContextMenu()` places them before the trailing rename / archive /
delete block.

## Right dock (§18.4)

`rightDockLayout()` is pure:

```
sideBySide  when W ≥ 48 + S + 640 + I + A + 44
sharedDock  when that does not fit, W ≥ 1280 and MAIN ≥ 640 with one column
overlay     otherwise (the panel floats and takes no layout width)
```

`S` is the sidebar width, tried first as the user left it and then as 56 — the
sidebar auto-collapses before the agent shrinks MAIN (UI-SPEC §25.5 rule 4).
`I ∈ {0, 328 quick, 360 comments, 560 task detail}`, `A ∈ [320, 560]` default
380. The shared dock puts the agent tab first in a 32 px strip and takes
`max(I, A)` as its column. The table test covers widths 960…2560 × every panel
combination and asserts MAIN ≥ 640 whenever the dock takes width.

## Agent panel (§18)

The panel is an ordinary omp session: `origin: 'agent-panel'`,
`labels: ['agent-panel']` — no new runtime, queue or orchestrator (ADR-U14).
Each user message stores its `contextSnapshot` (`SurfaceContext`), so the audit
shows exactly what the agent saw.

Privacy rules (`context.ts`, pure):

1. auto-attach never includes a `note` with `authority='local'` that is not the
   focus, a DM other than the open one, or any ref the user cannot read; such
   refs surface as a consent chip the user must click, and an unreadable ref is
   not offered at all;
2. excerpts are cut at 2,000 characters on a block boundary;
3. the snapshot is stored with the message;
4. `agent_panel.auto_context=false` in the approval-policy defaults makes the
   panel send explicit chips only.

The server-core expansion keeps the order
focus → textSelection → selection → locked → visible under 24 k tokens; an
unreadable ref becomes `{ref, restricted: true}` and a secret one is dropped.

UI state lives in `{configDir}/ui/agent-panel.json`,
`agent-panel-drafts.json`, `chrome.json` and (local-only) `pins.json`; only the
relative names are declared here, the caller resolves `~/rox` through
`@rox/shared/config`.

## Cross-functional capabilities (§20)

`XFN_CAPABILITIES` holds one row per X-13…X-26 with its entry points, owner
module, risk class, undo behaviour and the wave-2 package that replaces the
reference handler (XFN #1534, AGP #1532).

- **Commands** (schema-bound by `bindXfnContracts(registry, { schemas })`) —
  never re-declared: a name W1-03 already catalogs is *replaced* through
  `bindSchema`. Only `decisions.create` (X-15) and `tables.insert_row` (X-23)
  are new, in `catalogue/xfn.ts`.
- **Queries and the UI entry point** — `people.get_overview`, `agenda.today`
  and `agents.panel_open` are not commands and must never be added to the
  catalogue (asserted by the registry test).
- **Risk classes** — `XFN_RISK_CLASSES`, including X-19's maximum over its items
  and X-13 resolving to the owner command's class. `setXfnRiskResolver()` wires
  the registry-backed resolver.
- **Reference handlers** — `xfnReferenceHandlers({ ports, enabled })` over the
  single adapter `createXfnPorts()`; wave-2 swaps that one function. Every
  capability refuses with `XfnFlagOffError` while the flag is off.
- **Drop table (X-13)** — `(sourceKind, targetKind)` → owner command;
  `resolveDrop` / `resolveDropMany` report `unknown_pair` / `mixed_intent`
  instead of inventing a command.
- **X-26 pins** — `person:me → ref`, relation `relates-to`, role `pin`, anchor
  `{position}`; private to `created_by` and excluded from backlinks, search and
  activity (ACL rule `pin-private`). No domain event is emitted: a pin must not
  be observable to others. Local-only users keep `{configDir}/ui/pins.json`.
- **X-16 reminders** — the local `reminder` record gains `subjectRef:
  EntityRef`; at fire time it emits the W1-09 kind `reminder_due` (Inbox + OS).

## The W1-10 (#1507) harness gates

`scripts/run-unified-gates.ts` (packages/test-harness) runs three gates whose
input files this package owns; each fails closed once the file exists, so the
names below are part of the delivered contract:

| Gate | Reads | Contract |
|---|---|---|
| `chrome-schema-lint` | `packages/core/src/platform/chrome.ts` | `CHROME_SCHEMAS` — the rendered right zone per surface (`@rox` last) and the center-control count — plus optional `CHROME_SURFACES` |
| `dock-layout` | `apps/electron/src/renderer/platform/right-dock.ts` | `computeDockMode(width, preCollapseSidebar, inspector, agent)` → `sideBySide \| sharedDock \| overlay`, auto-collapse tried first |
| `agent-panel-privacy` | `packages/core/src/agent-panel/context.ts` | `decideAutoAttach(candidate, actor)` → `{ attach, redacted }` over the §18.3 fixtures |

Result on this branch: **7 pass / 0 fail / 5 pending** (the pending inputs belong
to #1503, #1510 and the wave-2 browser driver).

## Sibling wiring (unchanged by this package)

- W1-07 reserves the slot patterns `^[a-z][a-z0-9-]*\.chrome$`,
  `^[a-z][a-z0-9-]*\.sidebar\.[a-z0-9][a-z0-9-]*$` and
  `^agent\.context\.[a-z][a-z0-9-]*$` for `#1512`; this package only supplies
  the typed builders and the payload shape.
- W1-04's ACL engine has no rule set yet, so `pin-private` is registered in
  `LINK_VISIBILITY_RULES` (this package's own registry, append-only) and
  `registerLinkVisibilityRule()` is the one-line swap for #1508's registry.