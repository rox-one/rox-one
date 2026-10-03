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
