# 005 — Website repo access for Connect `clientId` flip

Ticket 14. Code: `packages/shared/src/auth/rox-cloud.ts` (`getRoxClientId`). Runbook: [`plans/identity-migration-plan.md`](../../identity-migration-plan.md) **O1**.

**Status:** OPEN — blocked on access to the private website repo.

**Owner:** product (pzd). An agent must not flip the default `clientId`.

## Context

Desktop Connect sends a device-flow `clientId` to `POST {rox}/api/auth/device/start`.

The accepting side lives in the private repo `rox-one/rox-one-website`. The value is contractual:

- Default (unchanged): `'craft-agents-desktop'`
- Override: `ROX_CLIENT_ID` (trimmed, non-empty)

Flipping the default to a Rox-branded id is a one-line client change **after** the website accepts that id. Old default must remain valid so already-issued clients keep working.

## Decision

**Do not flip the default.** Record that the missing piece is **website repo access + a website-side accept of a Rox `clientId`**, not more desktop code.

## Considered options (not chosen)

- **Flip default to `rox-one-desktop` (or similar) now** — rejected. The website would reject or ignore an unknown id; Connect would break.
- **Invent a website change in this repo** — rejected. The website is a different, private repository.

## What would flip this

1. Human access to `rox-one/rox-one-website`.
2. Website accepts a Rox `clientId` while still accepting `craft-agents-desktop`.
3. Then (and only then) change the desktop default, keeping `ROX_CLIENT_ID` as override.
