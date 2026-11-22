# Rox Cloud on rox.computer

Two pieces make the product look like Rox:

1. `preview-worker.js` — a Cloudflare Worker on `preview.rox.computer/*` that
   turns `https://preview.rox.computer/<port>-<signed-label>/…` into the
   provider's signed preview without exposing its host or error JSON.
2. A Cloudflare Tunnel that serves the local Rox Cloud app on
   `https://rox.computer/` and `https://app.rox.computer/`.

## Deploy the preview Worker

```sh
cd infra/cloudflare
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=4a3cd3637f84ad60046fd2b95b26185e \
  bunx wrangler deploy
```

The Worker route is `preview.rox.computer/*`. DNS in the `rox.computer` zone:

- `preview` A `192.0.2.1`, proxied. Universal SSL covers this one-level host.
- `ssh` CNAME `ssh.app.daytona.io`, DNS only; SSH is TCP, not HTTP.
- `rox.computer` and `app` point at the tunnel CNAME
  `<tunnel-id>.cfargotunnel.com`, proxied.

## Run the app tunnel

```sh
cloudflared tunnel --protocol http2 --no-autoupdate run \
  --token "$CLOUDFLARE_TUNNEL_TOKEN"
```

The tunnel ingress sends both `rox.computer` and `app.rox.computer` to
`http://127.0.0.1:8787`. QUIC is often blocked on this network; HTTP2 is the
working transport. Keep the local API on port 8787 while the tunnel is up.

The API rewrites a signed vendor preview to
`https://preview.rox.computer/<label>/` and an SSH command to
`ssh.rox.computer`; no provider host reaches the browser, clipboard or journal.
