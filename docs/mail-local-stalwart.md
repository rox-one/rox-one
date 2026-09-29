# Rox Mail — local Stalwart pilot (@rox.one)

Status: **local dev pilot**. Stalwart runs on this Mac only; Rox «Входящие → Почта»
talks to it over JMAP. External mail cannot reach it (no MX/DNS, no public ports) and
outbound delivery to other domains is disabled.

## Server

| | |
|---|---|
| Binary | `~/.rox/mail/bin/stalwart` (Stalwart Community v0.16.24, darwin-arm64) |
| Config | `~/.rox/mail/etc/config.json` |
| Data | `~/.rox/mail/stalwart/` (RocksDB) |
| Logs | `~/.rox/mail/logs/` |
| Autostart | LaunchAgent `~/Library/LaunchAgents/one.rox.mail.stalwart.plist` (RunAtLoad + KeepAlive) |
| HTTP / JMAP / admin | `http://127.0.0.1:8480` (loopback only, no TLS) |
| SMTP (inbound) | `127.0.0.1:2525` |
| Submission | `127.0.0.1:2587` |
| IMAP | `127.0.0.1:1143` (STARTTLS) |
| Domain | `rox.one`, hostname `mx.rox.one`, DKIM ed25519 generated (not published) |
| Outbound | remote route relays to `127.0.0.1:9` → messages to other domains stay queued locally |

Credentials live in the macOS Keychain, service `rox.mail.stalwart`
(accounts `admin@rox.one` and `recovery-admin`). Never commit or print them.

```sh
launchctl kickstart -k gui/$(id -u)/one.rox.mail.stalwart   # restart
launchctl bootout gui/$(id -u)/one.rox.mail.stalwart        # stop
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8480/healthz/live
```

### Local-only configuration applied

* Listeners bound to `127.0.0.1` only (no `[::]`, nothing on LAN/Tailscale).
* `MtaStageAuth.require` = `local_port != 25 && local_port != 2525` (and the same
  exclusion in `saslMechanisms`): port 2525 acts as the unauthenticated inbound MX
  port for local simulation; 2587 stays authenticated submission. Stalwart's defaults
  key "inbound MX" on port 25, so the SPF/DKIM/DMARC inbound checks keyed on port 25
  do not run on 2525.
* Outbound `MtaRoute "mx"` replaced by a relay to `127.0.0.1:9`: mail to other domains
  never leaves the Mac. Rox additionally refuses to send to non-@rox.one recipients
  while the server URL is loopback.
* Config changes made through the management API need a restart
  (`launchctl kickstart -k …`); startup takes 10–60 s.

## App wiring

* `packages/shared/src/mail/` — JMAP client (`jmap-client.ts`), Stalwart management API
  (`stalwart-admin.ts`), handle rules (`handle.ts`) and idempotent provisioning
  (`provisioning.ts`). This is the module the future rox.one signup hook will call.
* `apps/electron/src/main/mail/` — `MailService` (status, provisioning, folders, list,
  read, flags, move, delete, drafts, send via `EmailSubmission`, JMAP EventSource push)
  and direct IPC (`mail:*`). The device credential is a Stalwart **app password**
  stored through `CredentialManager` (`rox-mail.<address>`); the mailbox password is
  random and discarded after minting it.
* Renderer: `pages/inbox/mail/*` + `InboxPage.tsx` («Почта» section; unread mail also
  shows in «Все»).
* Flag `inbox.mail.v1` (default on; env `CRAFT_FEATURE_INBOX_MAIL=0` turns it off).
  Server URL: `ROX_MAIL_SERVER_URL`, or the form in the Почта status panel
  (stored in `~/.rox/mail/config.json` under the app config dir). Plain http is
  accepted only for loopback. `ROX_MAIL_HANDLE` overrides the handle (tests).
* Mailbox handle: rox.one account email/name → profile email/display name → `mark`.
  Stalwart account description `rox:<uuid>` marks the owner; a mailbox owned by someone
  else is never adopted (next free `handle2`, `handle3`, …).

## Testing locally

```sh
bun scripts/mail/inject-test-mail.ts --to mark@rox.one --from test@example.com \
  --subject 'Проверка' --html '<p>Привет</p>' --attach ./README.md
```

## Going public (not done — needs explicit approval)

1. A public host (VPS / dedicated) with ports 25, 465/587, 993, 443 open, static IPv4
   (+IPv6) with PTR `mx.rox.one`; TLS via ACME. Move the data dir or re-provision.
2. DNS for rox.one (currently MX points to Cloudflare Email Routing — must be replaced):
   * `mx.rox.one A <ip>` (+ `AAAA`), **DNS-only** (not proxied)
   * `rox.one MX 10 mx.rox.one.`
   * `rox.one TXT "v=spf1 mx -all"` (keep Resend include if it still sends for rox.one)
   * `mx.rox.one TXT "v=spf1 a -all"`
   * DKIM `v1-ed25519-20260929._domainkey.rox.one TXT` (value from Stalwart; add an RSA selector too)
   * `_dmarc.rox.one TXT "v=DMARC1; p=none; rua=mailto:postmaster@rox.one"` (tighten later)
   * `mta-sts.rox.one CNAME mx.rox.one.`, `_mta-sts.rox.one TXT "v=STSv1; id=…"`,
     `_smtp._tls.rox.one TXT "v=TLSRPTv1; rua=mailto:postmaster@rox.one"`
   * SRV `_jmap._tcp`, `_imaps._tcp`, `_submissions._tcp` → `mx.rox.one`
   * `autoconfig` / `autodiscover` CNAME → `mx.rox.one`
3. Re-enable the `mx` outbound route (remove the 127.0.0.1:9 relay), set the server URL
   in Rox to `https://mx.rox.one` (or `mail.rox.one` via a DNS-only record).
