# 003 — Cloud Runs auth: keep shared bearer

Ticket 14. Parent: [`docs/cloud-runs-prd.md`](../../../docs/cloud-runs-prd.md) (v1 bearer; “Auth craft-JWT — отдельный follow-up”).

**Status:** ACCEPTED — current shipping binding. This record does **not** schedule a JWT migration.

**Owner:** product (pzd). An agent must not start a JWT rewrite.

## Context

Cloud Runs talk to the Cloudflare / Modal gateways with a shared bearer:

- Secret name: `CLOUD_RUNS_TOKEN`
- On-disk: `<configDir>/cloud-runs.env` (0600, `KEY=VALUE`)
- Bootstrap: copy packaged `resources/cloud-runs.env` or write `process.env.CLOUD_RUNS_TOKEN` (`packages/server-core/src/handlers/rpc/cloud-runs.ts`)
- Wire: `Authorization: Bearer ${token}` on HTTP and the gateway WebSocket (`packages/cloud-runner/src/cloudflare-provider.ts`)
- Related desktop/server token: `ROX_SERVER_TOKEN` / `CRAFT_SERVER_TOKEN` (shared bearer for the local server, not a Cloud Runs JWT)

The ticket asked: **keep shared bearer** / **schedule JWT**.

## Decision

**Keep shared bearer.** v1 stays `CLOUD_RUNS_TOKEN` + `cloud-runs.env`.

The PRD already named run-scoped JWT as a follow-up (G5). That follow-up is **not scheduled**. No milestone, no date, no implementation ticket is opened by this record.

## Considered options (not chosen)

- **Schedule JWT now** — rejected. No human dated a migration. Inventing a schedule would be a product flip.

## What would flip this

A human-owned ticket that specifies the JWT issuer, audience, run-scoped claims, rotation, and a dual-run period with the existing bearer. Until then, do not replace `CLOUD_RUNS_TOKEN`.
