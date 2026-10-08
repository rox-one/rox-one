# Secrets model — inventory (T-18)

## Per-user keys (service provider)

| Secret | Resolution today | Storage today |
|--------|------------------|---------------|
| `ROX_API_KEY` | User paste / omp-first-run | `credentials.enc`, workspace env |
| `DAYTONA_API_KEY` | Operator `cloud-runs.env` | File, not per-user |
| `DEEPGRAM_API_KEY` | `server-services.ts` | `~/rox/service-secrets.env` |
| `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `E2B_API_KEY` | `server-services.ts` | Shared backend file |
| LiveKit | meetings/voice modules | Scout: workspace + server file |
| MCP builtin | `builtin-sources-seed` | Local seed + credential manager |
| `PINECONE_API_KEY` | Operator master in server vault, per-user ref (vector storage / agent memory) | Server vault → per-user ref |

MCP keys (`EXA`/`FIRECRAWL`/`BRAVE`/`LANGFUSE`) are provisioned per user from the operator master keys (decision 2026-10-08).

## Desktop DB

- `~/.rox` or `~/rox`: encrypted `credentials.enc`, per-workspace SQLite.
- **No** central multi-user DB in Electron.

## PocketID / server target (T-19)

1. Master secrets in server vault (encrypted at rest).
2. On SSO user create: `provisionDefaultSecretsForUser(userId)` → rotated refs per user.
3. Desktop receives refs via token exchange; never ships operator plaintext in app bundle.

See `packages/server-core/src/handlers/user-secrets-provision.ts` (stub).
