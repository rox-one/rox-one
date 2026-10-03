# ROX Pocket ID SSO Implementation Plan
> For agentic workers: use superpowers:subagent-driven-development. Read your task brief and docs/pocket-sso/spec.md contracts. Lead owns integration and review; separate repositories/file owners may execute in parallel.
Goal: first launch SSO + canonical personal account/org/wallet + automatically configured Swiss personal key and metered inference.
Spec: docs/pocket-sso/spec.md
## Global Constraints
All fixed product policy, shared external contracts, preservation and invariants in spec.md bind every task. No legacy account merge, no fake Telegram identity, no raw secret renderer/log/URL. No whole dirty-branch deployment.
## Review Focus
Same-email separate-account lookup; dropped redeem/refresh response; unknown external key creation; concurrent reserve/gift debit; late OMP generation after switch. Each owner adds its corresponding regression.
## Task 1: Source preparation and public Pocket migration
Owner lead/infra. Pin isolated source baselines, trust CT104 identity via Proxmox, backup+restore Pocket material, DNS/TLS/new issuer, passkey/admin recovery, public OIDC-client inventory/cutover. Swiss Pocket excluded. Check admin, old/new user, consumer acceptance.
## Task 2: Website Pocket identity and personal account
Owner website. Namespace-aware BetterAuth adapter and real token verification+nonce+PKCE; schema unique binding/legacy-only email; legal flow; forbid Pocket linking; idempotent personal org/default team/profile handle. Same-email/repeat-sub/concurrent callbacks+legacy regression.
## Task 3: Verified grant and transactional website billing
Owner website. Zero initial wallet; email verification500ROX one normalized-email claim; historical grants backfill; reserve/settle/status routes, own tariff snapshot, all debit/gift holds, audit. Race/idempotency/drop-ACK/invalid-event/outage tests.
## Task 4: Swiss account key provisioning and vault
Owner Swiss. Separate website_rox bindings/no Telegram rows; ensure/read/rotate/revoke routes and dedicated auth; durable operation/reconciliation; public key policies; encrypted recoverable vault; revoke through caches. Concurrency/crash/owner/legacy credit tests.
## Task 5: Mandatory gateway monetary guard
Owner Swiss. Managed key lookup, canonical routes allowlist/models six aliases, reservation before every wire send, quote full context+bounded output, synchronous journal and terminal outbox, delivery/recovery with site. Billing outage/stream/cancel/crash/fallback/cache/no doublelegacy settlement.
## Task 6: Website device v2 broker and cabinet
Owner website. PKCE start/poll atomic redeem+60s proof-bound result recovery; access15min/refresh30days rotate+replay; bootstrap/snapshot/credential/session logout routes; Pocket login/registration and account completion/email/key metadata/holds UI. Dropped responses, foreign proof/account, two-device logout.
## Task 7: Desktop SSO gate and trusted executor context
Owner desktop. Active core Connect registration reuses existing hardened flow; v2main client/bootstrap/secure store; startup auto external browser; actual registry tests; caller/account/generation flows to OMP/children/title/automation; account switch abort; unified snapshot cabinet/footer and locale parity; preserve native authority/local content. Native fresh/upgraded Mac/Win/relaunch/two-device/denied/outage and wrong ambient-key regressions.
## Delivery
Lead independently reviews each subsystem and integration; build verified images, run staging first charged inference+fault recovery, backup/apply compatible migrations then feature flags/canary, domain cutover gates, platform native verification/publish. Commit/push branches/PRs with exact readback; do not equate PR/local pass with production acceptance.
## CI portability repair (validate job 111284688231)
Owner backend-integration worker; lead owns independent review, integration/push and new CI readback. Dependency: exact macos-15/Bun1.3.14 failed job log at aa80de1b44d12a3fbbf425ce5aca8709617972ca. Own the missing private OMP models.yml in the account-domain test, preserve all account-key/late-callback/restart fences and add source-catalog preservation. Restore fixture environment on setup error and after child exit. Verification: original clean-home RED, targeted three tests and exact ten-file/47-test workflow batch; retain additional local OS-keychain timeout attempts and explicit unavailable-keychain seam. Report: reports/pocket-sso-ci-validation-repair/README.md. No product/workflow changes; original native candidate retained. Fresh remote CI remains pending until lead push/readback.
