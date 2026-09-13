# Tailscale policy — spec, not a live ACL

The live tailnet ACL is operator-owned and is not stored in this repository.
Keep a private backup outside Git. This file maps fleet role tags to the
constructs an operator applies in the Tailscale admin console.

## Spec → live-policy mapping

| Spec concept | Live construct |
|---|---|
| tag:control | `group:admins` until control-01 is separated from operator identity |
| tag:secrets | `tag:data` |
| tag:observability | scrape ports already opened per-tag |
| tag:automation | `tag:ci` |
| tag:compute / worker | `tag:app` / `tag:gpu` / `tag:ci` |
| tag:storage | `tag:drive` + `tag:data` |
| tag:mac | operator devices in `group:admins` |
| tag:exit | `tag:vpn` / `tag:proxy` with `autoApprovers.exitNode` |

## Enrollment

Mint single-use, preauthorized auth keys in the Tailscale admin console and
store them in the operator keychain or Infisical. Never commit auth keys.

```
tailscale up --auth-key="$(infisical secrets get TAILSCALE_ENROLL_APP --plain)" \
  --advertise-tags=tag:app
```

## Apply order

1. Enroll or re-tag nodes.
2. Verify SSH after each batch.
3. Only then: SSH-hardening roles, Coolify bootstrap.

Rollback for a bad tag batch is re-enroll without tags. ACL rollback is a
re-PUT of the private backup file.
