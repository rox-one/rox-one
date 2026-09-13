# ROX2 program (issue #315)

**Charter issue:** [#315](https://github.com/rox-one/rox-one/issues/315)
**Inventory base SHA:** `da4643517e61a9b4e9c958567441acf3541b09af` (main after #313)
**Verification named in the issue:** `01712a37` (pre-#313). Restamp this README when the inventory is refreshed.

This directory **opens** the unified product-platform program. It does **not** claim Drive, Mail, CRM, Tasks, calendar, canvas, or collab are live Conation integrations. Closing #315 means these artifacts exist, not that the 200 cards are implemented.

Do not infer product readiness from the number of merged PRs.

## Artifacts

| File | Role |
|---|---|
| `schema.ts` | Card / inventory / gap types |
| `inventory.ts` | Screens and services with evidence and coverage bounds |
| `inventory.json` | Machine-readable screen/service inventory |
| `conation-gap-matrix.json` | Soup/DSS/Board/Fund/flags vs native |
| `registry.ts` | Source of truth for 200 cards |
| `registry.json` | Emitted registry for other agents |
| `emit.ts` | `bun plans/rox2/emit.ts` |
| `packages/core/src/rox2/platform-contract.ts` | Entity / event / result / context contract |

## Evidence classes

Every claim is one of: `reproduced` / `statically-confirmed` / `documented` / `needs-verification` / `new-requirement`.

`queued`, `simulated`, and `fixture` are never `live`. Playground stories are fixtures.

## Constraints

- Native Rox UI is the product. Conation is a data/function adapter, not an iframe shell.
- Features stay available without Conation flags. Network clients default off.
- Sensitive actions (`device-read`, `cloud-send`, `share`, `publish`, `spend`, `destroy`) need an explicit grant/budget.
- Do not delete `LICENSE` / `NOTICE` or rename protocol, storage, or OAuth IDs (`~/.craft-agent`, `CRAFT_*`, `craftagents://`, `com.lukilabs.craft-agent`).
- Bugfixes are separate PRs. They do not close design cards.

## Single-owner files

Parallel tracks start only after this contract freeze. One in-flight owner:

| Seam | File |
|---|---|
| Transport | `apps/electron/src/transport/index.ts` |
| Types | `packages/core/src/rox2/platform-contract.ts` |
| Registry | `plans/rox2/registry.ts` |

## Waves

```
WAVE 0  ROX2-001..020   audit, contract, owners, identity freeze
WAVE 1  screens         native nav + settings (no iframe)
WAVE 2  conation        gap rows + list/read/act per type
WAVE 3  notes           native vault; SiYuan optional
WAVE 4  calendar         calendar/projects/canvas/mail/crm/drive
WAVE 5  context          right session / flags / session-apply
WAVE 6  memory           candidates ≠ applied
WAVE 7  collab           orgs/viewer/messaging ≠ multiplayer
WAVE 8  permission+rpc   grants + Rox2Result on RPC
WAVE 9  leftovers        cloud/voice/webui/fabric/identity closeout
```

## Agent instructions

1. Read this README and `packages/core/src/rox2/platform-contract.ts`.
2. Pick the lowest `status: open` card whose `dependencies` are already merged.
3. Implement only that card. Add tests. Do not mark fixture/queued work as live.
4. Leave `plans/rox2/registry.ts` card status `open` until acceptance is met; then a follow-up PR may mark it done.
5. Never force-push `main`. Never delete remote branches.

## Tests

```
bun test plans/rox2/__tests__/program.test.ts
bun test packages/core/src/rox2/__tests__/platform-contract.test.ts
```
