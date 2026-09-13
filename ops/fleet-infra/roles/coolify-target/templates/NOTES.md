# Coolify Target Node — Notes

## Server-add flow in Coolify
1. In Coolify dashboard: **Servers → + New Server**, choose *Localhost = no*, enter host.
2. Use the dedicated SSH port from `coolify_ssh_port` (default in role defaults), user `{{ coolify_user }}`.
3. The public half of the deploy keypair is installed by this role via `coolify_public_key_lookup`
   (host_vars / Infisical lookup). The private half lives in the Coolify UI secret store.
4. Confirm connectivity with Coolify's "Validate Server" button; it runs over the tailnet.

## Hardening contract
- Dedicated `sshd-coolify.service` binds only `{{ tailscale_ip }}:{{ coolify_ssh_port }}`.
- The primary SSH daemon and its port-22 access policy are not modified.
- `/etc/sudoers.d/90-coolify` grants passwordless sudo required by Coolify's
  server validator; the account is reachable only through the isolated endpoint.
- No private key or public key material is committed to fleet-infra.
