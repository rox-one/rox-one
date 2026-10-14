# @rox/canvas-relay

Sync relay for Rox «Доска». y-websocket protocol, SQLite persistence, signed room tokens.

Self-host:
```
RELAY_SECRET=$(openssl rand -hex 32) ALLOWED_ORIGINS=https://your.app TOKEN_ISSUER=https://id.example TOKEN_AUDIENCE=rox-canvas DATA_DIR=/var/lib/rox-canvas bun run src/main.ts
# or a single binary
bun run build:binary && RELAY_SECRET=... ./dist/rox-canvas-relay
# or Docker
docker run -e RELAY_SECRET=... -e ALLOWED_ORIGINS=https://your.app -v rox-canvas:/data -p 8787:8787 rox-canvas-relay
```
Put it behind TLS (Caddy/nginx). Clients connect to `wss://<host>/r/<workspaceId>:<boardId>?token=<jws>`. `GET /healthz` reports health.

Auth: pass the room token as a WebSocket subprotocol: `new WebSocket(url, ['rox-canvas.v1', token])` (the server echoes `rox-canvas.v1`). `?token=` is accepted for stock y-websocket clients; request URLs are never logged.

Origin allowlist: `ALLOWED_ORIGINS` is required. Browser requests whose `Origin` is not listed get 403; clients that send no Origin (the Rox desktop app) are allowed but still need a valid token.

Limits (env): `MAX_MESSAGE_BYTES` (1 MiB), `MAX_DOC_BYTES` (50 MiB), `MAX_CONNS_PER_ROOM` (100), `MAX_CONNS_TOTAL` (5000); per-connection rate limit 100 msg/s, 2 MiB/s. Sockets close with 4001 at token expiry.

Tokens: HS256 with required `iss`, `aud`, `iat`, `nbf`, `exp`, `sub`, `room`, `scope`; lifetime (`exp - iat`) at most 15 minutes. Clients refresh in-band before expiry by sending `[2, varString(newToken)]`; the same `sub` and room are required. Optional `epoch`: `relay.revoke(room, sub|'*', epoch)` rejects tokens below it and closes live sockets (4003). Share links never carry relay tokens; they're exchanged at the token endpoint for short ones.

Reverse proxy: the Rox desktop client sends the token only as a subprotocol. If you allow `?token=` clients, **disable query-string logging** at the proxy (nginx: log `$uri` instead of `$request`; Caddy: `log { format filter { request>uri query { delete token } } }`).

## Admin revocation

Set `RELAY_ADMIN_TOKEN` (≥ 32 chars, different from `RELAY_SECRET`; compared in
constant time) to enable `POST /admin/revoke`. It is served on a **separate
admin listener**, never the public port: `ADMIN_HOST` (default `127.0.0.1`; set
it to the host's tailnet IP so rox-id can reach it over tailscale) and
`ADMIN_PORT` (default `8788`). Requests with an `Origin` header are refused.

```
curl -X POST http://127.0.0.1:8788/admin/revoke \
  -H "Authorization: Bearer $RELAY_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"room":"<workspaceId>:<boardId>","sub":"<userId or *>"}'
# → {"ok":true,"closed":<n>,"epoch":<new min epoch>}
```

`epoch` is optional (defaults to the current minimum + 1).
Live sockets of that subject with a lower token epoch close with 4003; new
tokens must carry `epoch` ≥ the revoked value. Clients must offer the
`rox-canvas.v1` subprotocol next to the token; the token is never echoed.

## Storage

SQLite with `journal_mode=WAL` and `synchronous=FULL`. Only the part of an
update the room does not already have is stored; zero-growth updates are
dropped. Each room's update log is capped (`maxLogRows` 2000 / `maxLogBytes`
8 MiB); reaching a cap forces an immediate compaction even under steady load.
