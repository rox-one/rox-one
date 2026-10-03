# Pocket SSO rollout record

This record distinguishes preparation, deployed services and platform acceptance. No production identity or monetary migration has been applied yet.

## Infrastructure facts refreshed 2026-10-03

- Trusted web route: `tailscale ssh root@100.126.90.2`. Public Pocket upstream remains `192.168.1.104:1411`.
- Proxmox API responds at LAN `192.168.1.71:8006` from web. SSH host keys for Proxmox and CT104 are not in the trusted known-hosts file. Obtain identity through the trusted console route before accepting CT104's key.
- Cloudflare zone `rox.one` has active DNS records. `id.rox.one` currently targets a different origin, `44.212.103.96`, with proxy enabled; `pocketid.rox.one` targets `176.99.150.44` without proxy. This explains why the new hostname does not reach the public Pocket service. Keep the old record as rollback evidence until cutover.
- Existing web Certbot uses `dns-cloudflare`. A certificate for the new hostname can be prepared without changing its address record. Actual issuer cutover still depends on public Pocket backup and recovery.
- PostgreSQL 17 client/server utilities and age are available on web. `scripts/pocket-sso/backup-website.py` encrypts a read-only custom DB archive plus configuration; recovery key is root-only and separate from archives. Successful archive parsing is preparation evidence; isolated restore must also pass before migrations.

## Gate order

1. Pin source/image digests, finish isolated tests and independent subsystem review.
2. Take encrypted backup; restore PostgreSQL into an isolated database and verify canonical row counts and schema. Back up public Pocket DB, signing material, encryption material and configuration; verify restore separately.
3. Deploy namespace-aware website code with Pocket feature disabled before changing the email uniqueness constraint. Rollback must retain namespace filtering once duplicate emails exist.
4. Exercise a staging registration/device/key/charge and durable recovery against provider mocks, then real canary services.
5. Prepare new-domain TLS/proxy, maintain subject IDs, recover administrator access using the documented one-time code flow, and register a new-domain passkey. Inventory and exercise existing OIDC clients.
6. Change the public Pocket APP_URL and consumers, read back discovery/JWKS/subject continuity, then switch the new DNS record. Redirect the old user address only after acceptance.
7. Enable canary and verify real Mac/Windows first-launch, upgraded local profile, two devices, restart, logout, account switch, revoked key and one ledger charge. Publish artifacts only after native acceptance.

## Official references

Pocket configuration and backups must preserve the encryption key used for signing material: [environment variables](https://pocket-id.org/docs/configuration/environment-variables). Admin recovery is the supported [one-time access flow](https://pocket-id.org/docs/troubleshooting/account-recovery). Existing passkeys remain bound to their original [WebAuthn RP ID](https://www.w3.org/TR/webauthn-3/#relying-party-identifier).

## Preparation receipts

- Website encrypted backup: `/opt/rox-one/deploy-backups/pocket-sso-20261003T151155Z`. DB archive SHA256 `184281712985e9140dfdba5648d3429c1eb76fb223879d3a276184dfc61d2ecb`, 111330 bytes. Config archive SHA256 `84d4d1eb4820a4e9dcc170db9163affaf47fc48c740eb3d707fbdf90ad724afd`, 21694 bytes. Private recovery material and a copy of encrypted archives are held outside Git in operator storage.
- Full DB restore passed into isolated PostgreSQL 17.11, `pocket_restore` at loopback port 55439. Readback: 3 users, 2 organizations, 3 provider accounts, 2 balances and 2 ledger entries. Global `auth.users_email_unique` is present in this baseline. Canonical schema-only test fixture SHA256 `c9feaf52e5c8e2c290c1abecadd6687dd4b0a9c73c8181cd5f50b934760140e7`; website migration tests use this actual deployed schema.
- New-host certificate received successfully. CN `id.rox.one`, Let's Encrypt YE1, expiry `2027-01-01T14:15:42Z`, SHA256 fingerprint `21:DB:AF:FB:21:CF:BF:C4:E4:86:0D:1D:59:ED:87:CC:61:58:66:5B:75:0E:4A:33:FE:FC:51:05:09:F3:FA:A0`. Renewal config SHA256 `d51ac0ce807a92005df71b181c0474c33a4ac06efc5a727ce49fb1d401db2db8`. No hostname cutover or Pocket configuration change yet.
- Staged new SNI NGINX vhost points to the same public CT104 upstream. Config validation and reload passed; fresh direct TLS probes on 443 and 8443 return the new certificate and Pocket discovery with the old issuer, as expected before cutover. Safe access-log format excludes query strings, request bodies and credentials. Installed format SHA256 `a2f05716dc0431a6ebf74e736f1981ea38eda2a7b461339c658f78f0ecbf044a`; vhost SHA256 `39d9bb2f94a8335534fb502bfacad2491ecd6b1895a433377c30a2c57489cabc`. No DNS address or Pocket APP_URL change has been made.
- Desktop release workflow is available and supports Mac arm64 and Windows x64 packaging. Native account acceptance remains pending; a workflow definition or artifact build does not prove it.

## Review and source integration gates

Swiss initial independent review reproduced seven P1 defects in deployment packaging, accepted key transports, physical provider retries, auxiliary memory sends, rejected-reserve recovery, revoke operation replay and partial SSE usage. The original failure report is retained in the Swiss repository. F1/F2 repair `66d745c` passed 19 tests against a freshly applied maintained facade artifact; F3–F7 remain under repair and require revision-bound independent rechecks before build/deploy acceptance.

Desktop implementation began at accepted `c9b7330`; current remote main readback is `a3754c9eaab274b2f99d6a931659b0cac91a9993`. Integrate its runtime/credential/native-content changes and rerun affected boundaries before delivery. Existing dirty/conflicted release checkouts remain untouched.

Existing observability collector sources were frozen against live `core-20261003-reservation-r16`, source-only archive SHA256 `7ece6451a212297f526591a22f49163876475d324f2394793f700bc9c5938c73`. Candidate collector commit `2e7a97a` adds an independent operational audit migration and leased claim/commit/ACK pull worker; local PG tests pass on pinned Bun1.3.14. Production delivery and independent review remain pending.
