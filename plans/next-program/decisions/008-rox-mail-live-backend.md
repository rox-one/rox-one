# 008 — Rox Mail live backend and `inbox.mail.v1`

Ticket T9 (Rox Mail). Parent: [`docs/mail-local-stalwart.md`](../../../docs/mail-local-stalwart.md)
and the platform program (`docs/plans/2026-10-09-platform-program.md`).

**Status:** ACCEPTED for the shipped slice; three items remain **OPEN** for the
owner (pzd, `go@trysota.ru`) below. An agent must not invent the public host, the
loopback removal, or a different default flag from this note.

**Owner:** product (pzd). Live backend is operated, not coded, by an agent.

## Context

Rox Mail («Входящие → Почта») is the `inbox.mail.v1` feature. The shipped slice
is **client-side only**: the Electron renderer talks to a JMAP server through the
main-process bridge; no server half lives in the renderer.

- **Renderer** — `apps/electron/src/renderer/pages/inbox/mail/*` plus the
  «Почта» section of `InboxSidebar.tsx` / `InboxQueue.tsx`.
- **Bridge** — `apps/electron/src/shared/mail-local.ts` (the `mail:*` IPC
  contract, `MAIL_FLAG = 'inbox.mail.v1'`, `MAIL_DEFAULT_SERVER_URL`), served by
  `apps/electron/src/main/mail/mail-service.ts` (status, provisioning, folders,
  list, read, flags, move, delete, drafts, send; JMAP EventSource push). The
  mailbox credential stays in the main process (`CredentialManager`).
- **JMAP client** — `packages/shared/src/mail/` (`jmap-client.ts`,
  `stalwart-admin.ts`, `handle.ts`, `provisioning.ts`).
- **Live server half** — `services/rox-maild` (Bun/TypeScript: signed inbound
  relay + mailbox provisioning; see its `docker-compose.yml`) in front of
  **Stalwart**, which owns all mailbox state. On the pilot host Stalwart is the
  loopback deployment described in `docs/mail-local-stalwart.md`.

So the feature is **client-side**: shipping it is a renderer + main-process
change, and the backend is a separate, operated service.

## The flag `inbox.mail.v1`

`inbox.mail.v1` defaults **ON**. `MailService.config()` resolves
`enabled: flag ?? file.enabled ?? true` (`apps/electron/src/main/mail/mail-service.ts`),
so mail is on unless the `CRAFT_FEATURE_INBOX_MAIL=0` / `false` environment
variable or the persisted `config.json` turns it off.

**When the flag is OFF** the renderer shows the honest one-line reason
(`inbox.mail.status.disabled`, «Mail is off (flag inbox.mail.v1)») but the
**«Почта» section and its navigation entry stay visible** — the user still sees
that the surface exists and why it is inert. No fabricated mailbox, no fake
empty state, no dead action. This is the binding this record fixes for the UI.

## Public host

`MAIL_DEFAULT_SERVER_URL` is `https://mail.rox.one` and the client probes
`/api/health` on a non-loopback base (`/healthz/live` on loopback, i.e. the
Stalwart pilot). **`mail.rox.one` answers HTTP 530 today** (Cloudflare Tunnel
origin offline), so a default install is honestly `unreachable` rather than
silently broken; the Почта status panel exposes the server-URL form for an
operator override.

## Shipped slice (this record) — no new backend

1. This decision record plus the `decisions/README.md` row.
2. Minimal UI honesty for the OFF flag (see *The flag* above), inside
   `apps/electron/src/renderer/pages/inbox/**`:
   `InboxSidebar.tsx`, `InboxQueue.tsx` and `mail/MailPanels.tsx`. The section
   and its entry stay visible; the disabled one-liner is shown and no mailbox
   interaction is offered while the flag is off. No server code is added or
   invented.

## Open owner decisions

These are product/ops decisions, not code:

1. **Default flag.** Keep `inbox.mail.v1` default ON (current) or flip the
   default off until the public host is live. Only a human flips this.
2. **Public host.** Bring `mail.rox.one` back (Cloudflare Tunnel origin) or
   point `MAIL_DEFAULT_SERVER_URL` at a different public host. Until then the
   default install reports `unreachable`.
3. **Loopback restriction.** Decide whether the shipped product keeps the
   loopback-only pilot binding (`127.0.0.1:8480` / `:2525`, no MX/DNS) or
   publishes Stalwart publicly. Removing the loopback restriction is an
   infrastructure change operated by a human.

## Considered options (not chosen)

- **Hide the «Почта» section when the flag is off** — rejected. The owner
  binding is that the section/entry stay visible with an honest reason, so the
  surface is discoverable instead of silently vanishing.
- **Invent a cloud/remote mail backend in this repository** — rejected. The
  live half is `services/rox-maild` + Stalwart, operated out of band; the
  renderer must not fabricate a backend.
- **Hard-code a public host or flip the flag default** — rejected. Both are
  owner decisions listed above.

## What would flip this

A human (pzd) resolving the three open items, or a ticket that changes the
`inbox.mail.v1` default or the shipped server URL. Until then the client stays
as recorded: default ON, honest when off/unreachable.

## Evidence

- Flag + IPC contract: `apps/electron/src/shared/mail-local.ts`
  (`MAIL_FLAG`, `MAIL_DEFAULT_SERVER_URL`, `mail:*`).
- Flag default + reachability: `apps/electron/src/main/mail/mail-service.ts`
  (`config()` → `enabled: flag ?? file.enabled ?? true`; `status()` →
  `enabled`/`reachable`/`state`; loopback probe `isLoopbackUrl`).
- Renderer slice: `apps/electron/src/renderer/pages/inbox/mail/`
  (`useMail.ts`, `MailPanels.tsx`, `mail-view.ts` `statusKey`) and
  `InboxSidebar.tsx` / `InboxQueue.tsx`.
- Live backend: `services/rox-maild/` (`src/*`, `docker-compose.yml`,
  `README.md`); JMAP client `packages/shared/src/mail/`.
- Pilot deployment: `docs/mail-local-stalwart.md`.
- `mail.rox.one` status: HTTP 530 at the time of writing (Cloudflare Tunnel
  origin down).