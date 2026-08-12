# Secrets Providers — scoped secret injection for agent subprocesses

Status: v1 vertical slice (runtime only, no UI). Implemented in
`packages/shared/src/secrets/`.

## Model

A **secret ref entry** in `config.json → runtime.secretRefs` declares that one
secret, resolved from a provider at spawn time, should be injected into every
agent subprocess environment:

```jsonc
{
  "runtime": {
    "envOverrides": { "PLAIN_FLAG": "1" },
    "secretRefs": [
      // environment provider, default ref ROX_SECRET_OPENAI
      { "name": "openai", "envVar": "OPENAI_API_KEY" },

      // local encrypted store (~/.craft-agent/credentials.enc), explicit account
      { "name": "staging-token", "envVar": "STAGING_TOKEN",
        "provider": "local-encrypted", "ref": "service_oauth::global::staging-token" },

      // Infisical, pinned; secret name defaults to `name`
      { "name": "DB_URL", "envVar": "DATABASE_URL",
        "provider": "infisical", "ref": "DB_URL" }
    ]
  }
}
```

Entry shape (`SecretRefEntry`, zod-validated in config validators):

| field      | meaning |
|------------|---------|
| `name`     | logical name — safe for logs/diagnostics, never the value |
| `envVar`   | target env var in the agent subprocess (POSIX name; denylist like `PATH`, `NODE_OPTIONS`, `CRAFT_*` rejected) |
| `provider` | optional pin to one provider; omitted = walk the chain |
| `ref`      | optional provider-specific reference (defaults below) |

### Providers (`SecretProvider`)

Resolution order is configurable; default chain: **environment →
local-encrypted → infisical** (first hit wins).

| provider | `ref` default | resolves from |
|----------|---------------|---------------|
| `environment` | `ROX_SECRET_<NAME>` (name uppercased, non-alnum → `_`) | process env, gated by an allowlist of prefixes (default `ROX_SECRET_`; arbitrary env like `ANTHROPIC_API_KEY` is unreachable) |
| `local-encrypted` | `service_oauth::global::<name>` | the existing `CredentialManager` (AES-256-GCM `~/.craft-agent/credentials.enc`) — adapter, no reimplemented crypto |
| `infisical` | `<name>` | Infisical REST API `GET {baseUrl}/api/v3/secrets/raw/{secretName}?workspaceId=…&environment=…&secretPath=…`, `Authorization: Bearer <token>` |

Infisical configuration (options or env): `INFISICAL_TOKEN` (service token /
machine-identity access token), `INFISICAL_PROJECT_ID`,
`INFISICAL_ENVIRONMENT`, plus optional `INFISICAL_BASE_URL` (default
`https://app.infisical.com`) and `INFISICAL_SECRET_PATH` (default `/`).
Successful lookups are cached in memory for 60s; misses are not cached.
Failures are typed: `INFISICAL_UNAVAILABLE` (not configured / network /
unexpected response), `INFISICAL_AUTH_FAILED` (401/403); 404 → `null`
(not found). No CLI dependency.

## Spawn-time injection flow

```
SessionManager.spawn
  └─ await refreshRuntimeSecretEnv()            // secrets/runtime.ts, never throws
       └─ resolveSecretsForSpawn(refs)          // chain.ts
            ├─ env fragment → setRuntimeSecretEnvFragment()   // in-memory ONLY
            ├─ values → registerSecretValues()                // redaction registry
            └─ diagnostics (value-free) → debug log (redacted)
getRuntimeEnvOverrides()                        // config/storage.ts — THE seam
  = { ...persisted envOverrides, ...secret fragment }
  └─ spread into subprocess env by every backend (claude/pi/omp)
```

`getRuntimeEnvOverrides()` stays synchronous (all backends call it in object
literals), so resolution happens just before in the async spawn path. On key
collision the secret wins over plain `envOverrides`; per-session structural
keys (`CRAFT_WORKSPACE_PATH`, mini-model) applied afterwards still win.

## Security invariants

1. **Values touch only subprocess env.** Refs (never values) are persisted in
   `config.json`. The resolved fragment is in-memory module state.
2. **Renderer never sees values.** The settings RPC `GET_ENV_OVERRIDES`
   returns `getPersistedRuntimeEnvOverrides()` (config only), not the merged
   spawn composition.
3. **No serialization into transcripts/prompts.** The injection path mutates
   only the env object handed to `spawn()`. Covered by
   `secrets/__tests__/non-serialization.test.ts`.
4. **Value-free diagnostics.** Per-entry outcomes carry
   name/envVar/status/errorCode only; the chain's own debug logging passes
   through the redaction registry.
5. **Redaction utility.** `redactSecrets(text, values)` masks known values
   (min length 4, literal substring, longest-first); a process-wide registry
   (`registerSecretValues` / `redactRegisteredSecrets`) is fed on every
   refresh. MCP stdio already blocks known-sensitive env names
   (`BLOCKED_ENV_VARS` in `mcp/client.ts`); injected secrets travel only in
   the agent subprocess env, and like any env var could be read by tools the
   agent runs — same trust model as `runtime.envOverrides`.
6. **envVar denylist.** Secret targets go through the same validation as env
   overrides: no `PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, `CRAFT_*`, etc.

## Failure semantics

- Provider `resolve()` returns `null` = not found (chain continues).
- Operational failures throw `SecretResolveError` with a typed code; the
  chain records a value-free diagnostic and continues (pinned entries stop).
- Entry unresolved everywhere → diagnostic `SECRET_NOT_FOUND`; the env var is
  simply absent from the fragment (spawn proceeds).
- `refreshRuntimeSecretEnv()` never throws; on unexpected failure the
  previous fragment stays in place.

## NOT covered yet (explicit gaps)

- **No UI / RPC management** for `runtime.secretRefs` (edit `config.json` or
  use `setRuntimeSecretRefs`).
- **No Infisical `list()`** (needs the list endpoint; provider interface has
  it optional — environment and local-encrypted implement it).
- **No machine-identity token exchange** (client-id/secret → access token);
  bring a ready token via `INFISICAL_TOKEN`.
- **No per-workspace / per-backend scoping** of refs (all refs apply to all
  sessions); `ResolveTarget` is the future hook.
- **No refresh-on-config-change watcher**; refresh happens at session spawn
  (and on demand via `refreshRuntimeSecretEnv()`). Long-lived sessions keep
  the env they were spawned with — respawn to pick up rotated secrets.
- **Infisical v4 API** (`/api/v4/secrets/{name}`, `projectId` param) not
  wired; v3 raw endpoint is what service tokens support broadly.
