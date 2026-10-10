# 011 — Screens (T12): each flag gets a decision, not a promise

Ticket 12. Parent: [`docs/plans/2026-10-10-main-guardrails-and-ui-to-code.md`](../../../docs/plans/2026-10-10-main-guardrails-and-ui-to-code.md) **§«T12»**, appendix **A1 / A8 / A9 / A13**.

**Status:** ACCEPTED — shipped slice. **E4 (dead sub-flags) is OPEN** — keep the flags, do not remove them.

**Owner:** product (pzd) / lane-UI-5.

## Context

T12 is the «interface → code» slice for the screens: Playbooks (A1), the extra
screens under «Ещё» (A9), the Dev Space tour (A8) and the Dev Space surface
gated behind a flag (A13). Its acceptance is one sentence:

> по каждому флагу зафиксировано решение; включённое работает, выключенное не обещает
> («for every flag a decision is recorded; what is on works, what is off does not promise»).

No «perpetual Soon» and no dead buttons: an element either does real work, or it
honestly explains why it cannot (without pretending it will).

## Decision

Per flag, the shipped binding is:

- **Playbooks master `playbooks.v1`** — stays a real, user-owned switch. The
  surface is OFF by default; when ON the notebooks work, when OFF the page shows
  the honest disabled notice. Already shipped (`playbooksEnabledAtom`).
- **Playbooks sub-flags `playbooks.knowledge.v1` / `playbooks.codebook.v1`** —
  now have explicit toggles in Settings → Playbooks, rendered via
  `workbenchFlagAtom` (sample `platform/unified-flags.ts:96-109`). Each mode is
  OFF until enabled and is **ANDed with the master**: with `playbooks.v1` off the
  mode cannot activate on its own.
- **Dev Space master `devspace.v1`** — a real user-owned switch, default OFF.
  A deep link now reaches an **honest disabled state** in both `DevSpaceHomePage`
  and `DevSpaceRepoPage` (sample `pages/extra-screens/ExtraScreenHost.tsx:37-49`)
  instead of a blank or half-working workspace; the
  «Открыть в Dev Space» button in `ProjectRoadmapPage` is **hidden while OFF**.
- **Dev Space sub-flag `devspace.autoWatch.v1`** — now has a toggle in
  Settings → Developers, and is **ANDed with `devspace.v1`** in
  `DevSpaceRepoPage`.
- **Extra screens (`workbench.mode.<id>.v1`)** — each carries an honest
  `extraScreens.<id>.description` in the settings list; the missing
  `activity` / `library` / `health` descriptions were added in **all 12 locales**
  (en/ru authoritative, the other ten translated).
- **Stale copy removed.** The «coming soon / later waves» strings in the
  Playbooks surface and its settings (keys kept, values rewritten) now say the
  truth: the mode is *off until you enable it*, and turning the master on does
  not by itself promise the modes.

## E4 — dead sub-flags (OPEN, do not delete)

These flags are registered in `packages/core/src/platform/workbench/flags.ts`
with `defaultValue: false` and `dependencies: [devspace.v1]`, but **no renderer
consumer**:

- `devspace.ingest.v1`
- `devspace.tools.v1`
- `devspace.questions.v1`
- `devspace.tours.v1`
- `devspace.ask.v1`

The tour surface (A8) and these modes are not implemented pending the tour/ingest
contract. **This record does not delete them.** A human must first decide whether
each becomes a real mode or is retired; until then they stay registered so the
next agent does not «clean up» a flag whose owner is undecided.

## Considered options (not chosen)

- **Delete the dead sub-flags now** — rejected. Their owner (tour/ingest
  contract) is unresolved; deleting them is a product decision, not a cleanup.
- **Show the modes as «disabled» placeholders** — rejected. That is exactly the
  «perpetual Soon» the acceptance forbids; mode toggles are honest OFF switches
  and the surfaces state their own gate.
- **Gate only the rail, keep the routes live** — rejected. A deep link would hit
  a blank page; the pages now state the gate themselves.

## What would flip this

1. A human decides, per dead sub-flag, to implement it or retire it — then E4
   closes and the flags move or are removed in a follow-up.
2. A tour/ingest contract lands — `devspace.tours.v1` / `devspace.ingest.v1`
   become real toggles like `autoWatch`.

Until then the flags stay as registered and the surfaces stay honest.