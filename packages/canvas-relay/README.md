# @rox/canvas-relay

Sync relay for Rox «Доска». y-websocket protocol, SQLite persistence, signed room tokens.

Self-host:
```
RELAY_SECRET=$(openssl rand -hex 32) DATA_DIR=/var/lib/rox-canvas bun run src/main.ts
# or a single binary
bun run build:binary && RELAY_SECRET=... ./dist/rox-canvas-relay
# or Docker
docker run -e RELAY_SECRET=... -v rox-canvas:/data -p 8787:8787 rox-canvas-relay
```
Put it behind TLS (Caddy/nginx). Clients connect to `wss://<host>/r/<workspaceId>:<boardId>?token=<jws>`. `GET /healthz` reports health.
