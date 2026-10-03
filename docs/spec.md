# ROX account SSO specification
Accepted 2026-10-03. Owner: integration lead. Website/auth, Swiss key/billing, desktop have separate writers and checkouts.
## Required outcome
New/upgraded desktop must authenticate through public Pocket ID at https://id.rox.one. rox.one owns canonical users, personal organization/owner, sessions, public handle, ROX wallet and ledger. eu-swiss OmniRoute issues a personal inference key. Desktop configures it automatically without raw secrets in renderer/URLs/logs.
## Fixed product policy
- Pocket accounts are separate from ALL legacy accounts, including equal email and existing legacy cookie. No automatic linking or balance/org transfer.
- Namespace legacy/pocketid in shared auth.users; real email remains real. Only legacy email is unique. Pocket binding exact validated issuer/sub.
- Personal organization and owner membership are idempotent. No allowed-domain autojoin for Pocket.
- Initial balance 0. Grant 500 ROX once per verified normalized email; existing grants consume eligibility. Currency scale6, 100ROX/USD. No legacy $200/$100 Core grants.
- Public handle existing 4–16 lower ASCII a-z0-9_; reserved/taken rejects; valid free preferred_username auto-claims, otherwise authenticated completion form.
- One account personal inference key, separate device sessions. Ordinary logout revokes only that device session; rotation/revoke is explicit account-wide action.
- New keys billing_source=website_rox, separate from legacy Telegram managed_users/managed_keys. Canonical money stays PostgreSQL.
- Six model IDs: rox/r1-max, rox/explore, rox/standard, rox/max, rox/vision, rox/fast. Parent r1-max, child fast. New key endpoints only GET /v1/models, POST /v1/chat/completions until instrumented.
## Evidence / preservation
Desktop pinned source c9b7330357fb55a5e88a223783029d2768849828; remote main may advance. Original release 29e86+220 paths+19 unmerged preserved. New worktree is isolated.
Website running /opt/rox-one/releases/site-20261001-platform-retina-fix matches baseline e9551a348685e349ca94ce476fdb6685e5db1535. Newer575a560 optional observability preserved separately. PG17.10 rox_prod 192.168.1.105:5433, 3users/2orgs at audit.
Public Pocket NGINX on web100.126.90.2 proxies192.168.1.104:1411. Swiss Pocket DIFFERENT JWKS; never move it. Public CT104 SSH host identity must be established before cutover. Backup DB/signing/encryption/config, test restore and admin/new-domain passkey recovery, inventory public OIDC clients.
Swiss VM sw europe-west6-b project project-66a9c35d-5049-4078-ae6; gateway3.8.52 image aea5dc074f429fc2b7b99c7ccede7728e8c52805c3395d77414df0b17c4236d9; Core image d26341f88499e5291f0c04d60d12ed4bacf1db15ed18c86ec7dbc47596b8199e, only migrations1–8. Local d866f81 has additional undeployed work; do not deploy it wholesale.
## Shared external contracts (all implementations use these)
Broker stays https://rox.one; IdP issuer https://id.rox.one; inference base https://api.rox.one/v1; desktop clientId craft-agents-desktop.
Device v2 endpoints /api/auth/device/v2/start|poll|refresh|logout:
start {clientId,code_challenge,code_challenge_method:"S256"} -> existing device response snake_case fields (TTL900, interval5).
poll {device_code,code_verifier,redemption_id} -> {status:"approved",access_token,refresh_token,token_type:"Bearer",expires_in:900,user:{id,email,name,image}} or pending/slow_down/denied/expired.
refresh {refresh_token,refresh_id} -> rotated approved token envelope. Refresh lifetime30days. Retry same proof+operationId returns same encrypted cached result for60seconds; mismatch cannot obtain it. Access/device sessions are hash-only at rest except narrowly encrypted replay cache.
POST /api/me/bootstrap idempotently ensures account/org/zero wallet/key job then returns snapshot. GET /api/me/account reads snapshot only.
Snapshot {state:"authenticated"|"provisioning"|"ready"|"failed",user:{id,email,emailVerified,name,handle,profileUrl},organization:{id,name,slug,role},balance:{currency:"ROX",balanceRox,heldRox,availableRox,bonusStatus},key:{id,prefix,generation,status}|null,updatedAt,errorCode?}. Money strings scale6. Names nullable where pending.
POST /api/me/inference-credential -> {accountId,keyId,generation,apiKey,baseUrl}. Authenticated account derived server-side; not body userId. Main process stores; renderer gets only snapshot/mask.
Swiss POST /internal/rox-accounts/v1/ensure {accountId,organizationId,operationId,generation:1} -> {status,key:{id,prefix,generation,createdAt}}.
Swiss GET /internal/rox-accounts/v1/accounts/:accountId/credential -> same credential envelope.
Swiss POST .../accounts/:accountId/rotate and .../revoke; dedicated ROX_PROVISIONING_TOKEN, TLS, narrow machine routes and durable operation replay fence. Website env ROX_PROVISIONING_BASE_URL/ROX_PROVISIONING_TOKEN; Swiss same token separately from CONTROL_API_TOKEN.
Website billing POST /internal/rox-billing/v1/reserve {requestId,operationId,keyId,logicalModelId,resolvedModelId,tariffVersion,inputTokenBound,outputTokenBound} -> {reservationId,tariffVersion,heldRox,...limits}; GET /internal/rox-billing/v1/reservations/:requestId.
POST /internal/rox-billing/v1/settle {eventId,requestId,reservationId,keyId,status,inputTokens,outputTokens,executionReceipts,payloadHash}. Terminal completed/cancelled/failed/not_dispatched/needs_reconciliation. Dedicated ROX_BILLING_TOKEN; backend computes/validates own pricing, never client price.
Gateway ROX_BILLING_BASE_URL/ROX_BILLING_TOKEN. Immutable gateway-generated logical request ID and execution IDs; client x-request-id is not money identity. Duplicate same ID+payload same receipt; mismatch409. Public tariffs from existing website primitives resolved model snapshot; invalid/missing tariff fails closed.
## Invariants / failure behavior
Cryptographic OIDC verification exact issuer/aud/signature/expiry/nonce/sub with PKCE; no decodeJwt-only identity. Provider identity unique; signed legal evidence before ROX registration.
Transactional personal org/wallet creation after committed registration; durable outbox for remote provisioning; unknown outcome reconciles exact operation, not duplicate key.
Reserve locks wallet and available=balance-held; all debit paths including gifts obey holds. Settlement atomic usage+ledger+balance+release, unique request event/charge. Insufficient402/blocked403/billing unavailable503 and no upstream send.
Gateway mandatory sync journal/outbox covers nonstream/SSE/cancel/error. Missing usage/dispatch crash becomes needs_reconciliation; no guessed refund or free usage. Legacy Core credits/topups/settlement skip website_rox.
Trusted runtime {caller,cloudAccountId,authGeneration} inherited by child/call_llm/title/automation. Account key overrides ambient/session env only for builtin public ROX. Switch/logout stops old runtime, late writes ignored. Native workspace authority/grants stay distinct.
OS-backed protection new account secrets on Mac/Windows; no raw secret in renderer, URLs, logs, analytics. Preserve existing local chats/config/workspaces, use no destructive auth.LOGOUT.
All UI strings t()/full locale parity; central account snapshot for cabinet/footer, no gamification-money fallback.
## Acceptance and rollout
TempPG17/tempSQLite/provider-mock races, same-email separation, repeat subject/device, grant uniqueness, reserve/gift concurrency, exactly-one settlement, outbox/restart, key revoke/cache failure, late generation callbacks.
Actual core registry integration (not legacy direct import), OMP RPC and mini/title with wrong ambient/envkey, fresh+upgraded Mac/Windows browser flow, restart/two-device/logout/switch.
Namespace-aware disabled-feature website release precedes schema/email index cutover. Rollback only namespace-aware code after duplicate emails exist. Public IdP backup/recovery/consumer tests before host cutover. Full staging charged inference before production canary and platform releases.
Operational audit events correlate account/org/key/request IDs, source/outcome/time without secrets; separate from marketing consent.
Done only after published Mac/Windows builds and live services pass the full flow with exact revision/image/artifact evidence. Partial proof remains partial.

