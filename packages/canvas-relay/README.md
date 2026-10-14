# @rox/canvas-relay

Sync relay for Rox «Доска». y-websocket protocol, SQLite persistence, signed room tokens.

Self-host:
```
RELAY_SECRET=$(openssl rand -hex 32) ALLOWED_ORIGINS=https://your.app DATA_DIR=/var/lib/rox-canvas bun run src/main.ts
# or a single binary
bun run build:binary && RELAY_SECRET=... ./dist/rox-canvas-relay
# or Docker
docker run -e RELAY_SECRET=... -e ALLOWED_ORIGINS=https://your.app -v rox-canvas:/data -p 8787:8787 rox-canvas-relay
```
Put it behind TLS (Caddy/nginx). Clients connect to `wss://<host>/r/<workspaceId>:<boardId>?token=<jws>`. `GET /healthz` reports health.

Auth: pass the room token as a WebSocket subprotocol: `new WebSocket(url, ['rox-canvas.v1', token])` (the server echoes `rox-canvas.v1`). `?token=` is accepted for stock y-websocket clients; request URLs are never logged.

Origin allowlist: `ALLOWED_ORIGINS` is required. Browser requests whose `Origin` is not listed get 403; clients that send no Origin (the Rox desktop app) are allowed but still need a valid token.

Limits (env): `MAX_MESSAGE_BYTES` (1 MiB), `MAX_DOC_BYTES` (50 MiB), `MAX_CONNS_PER_ROOM` (100), `MAX_CONNS_TOTAL` (5000); per-connection rate limit 100 msg/s, 2 MiB/s. Sockets close with 4001 at token expiry.
