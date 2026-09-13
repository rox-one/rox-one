# Automation Identity — Ansible/Windmill

## Credential

- Private key lives only on the operator workstation (`~/.ssh/fleet_ansible_ed25519`).
- This key is not a shared fleet key: it authorizes only the `fleet-ansible`
  automation user created by `roles/users` on managed nodes.
- Fingerprints are operator-local evidence; they are not stored in Git.

## Distribution contract

1. During enrollment (`roles/users`), the public key is injected into
   `/home/fleet-ansible/.ssh/authorized_keys`.
2. sudo: limited NOPASSWD allowlist from `roles/users` defaults
   (systemctl restart on allowlisted units, apt-get, docker) — no full root.
3. Revocation: remove the authorized_keys line and lock the user; the private
   key never lives on target disks.

## Rollback

Remove the key from all nodes and delete the local private key. No other
dependency exists.
