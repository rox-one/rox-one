# 004 — appId / auto-update: no bridge date

Ticket 14. Runbook: [`plans/identity-migration-plan.md`](../../identity-migration-plan.md) **M5**.

**Status:** ACCEPTED — current shipping binding. This record does **not** invent a calendar date and does **not** say “not this year” as a commitment. It says: **no bridge build is dated**.

**Owner:** product (pzd). An agent must not flip `appId` / `productName`.

## Context

`apps/electron/electron-builder.yml` still ships:

- `appId`: `com.lukilabs.craft-agent`
- `productName`: `Craft Agents`

`appId` is load-bearing for electron-updater. A new id makes existing installs stop receiving updates, and on macOS it also affects Keychain ACLs, Login Items, and TCC entries.

M5 describes a bridge build that keeps the old id, dual-hosts update manifests, then ships `com.rox.one.desktop` (or a chosen Rox id).

The ticket asked: **date the bridge build**, or **explicit “not this year”**.

## Decision

**No date is set.** Until a human dates M5:

- `electron-builder.yml` stays Craft-branded
- no agent changes `appId` / `productName` / artifact names
- “not this year” is **not** recorded as a promise — only “no date”

## Considered options (not chosen)

- **Date a bridge build in this record** — rejected. No human supplied a date.
- **Commit “not this year”** — rejected as an invented calendar. The operational equivalent is the same (do not flip now) without pretending a year-end review happened.

## What would flip this

A human dates the M5 bridge build (or explicitly writes “not this year” / a later year) and owns the dual-manifest updater endpoint. Until then, identity work stays in the safe rename class (UI strings, `ROX_*` env aliases), not the installer id.
