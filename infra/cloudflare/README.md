# Rox preview proxy

Cloudflare Worker that makes a signed Daytona preview link reachable as
`https://<port>-<token>.rox.computer` without exposing the provider host.

Deploy (token is read from the environment and never stored here):

```sh
cd infra/cloudflare
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=4a3cd3637f84ad60046fd2b95b26185e \
  bunx wrangler deploy
```

DNS records in the `rox.computer` zone:

- `*` A `192.0.2.1`, proxied. The Worker route catches every subdomain and
  returns 404 unless the first label is `<port>-<signed-token>`.
- `ssh` CNAME `ssh.app.daytona.io`, DNS only. SSH is TCP, so the Worker route
  does not touch it; clients see `ssh.rox.computer` and the gateway alias
  resolves to the vendor gateway.

The API rewrites the vendor preview suffix to `.rox.computer` and the SSH host
to `ssh.rox.computer`; the Worker hides the upstream 5xx JSON behind a plain
Rox error page.
