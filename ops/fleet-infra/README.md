# fleet-infra

Ansible-driven fleet control plane for ROX machines (Ubuntu 24.04, amd64 + arm64).

Recovered from the private control-plane product (`agisota/fleet-infra`,
completion branch `codex/fleet-infra-completion-20260826`) after the named tip
`10cf005f` / branch `codex/rox-fleet-infra-20260825` was missing from this clone.
Live host addresses, Tailscale ACLs, and enroll keys stay out of Git; this
tree ships an example inventory on TEST-NET-1 (`192.0.2.0/24`).

## Layout

```
playbooks/site.yml              full-fleet convergence (mutation roles fail-closed)
playbooks/discovery.yml         read-only fact gathering -> reports/before/<host>.md
playbooks/observability-control.yml
playbooks/windmill-control.yml
playbooks/bootstrap-coolify-deploy-key.yml
playbooks/netbird-retire.yml
inventory/hosts.yml             example groups (overlay private host_vars locally)
inventory/group_vars/all/     fleet-wide defaults + pinned versions.yml
roles/                        base, users, ssh, firewall, tailscale, docker, netdata,
                              infisical-agent, coolify-target, windmill-*, agent-runtime,
                              backups, observability-control, netbird-retire
scripts/                      idempotent bootstrap helpers (env-driven, no inline secrets)
windmill/                     maintenance steps (Infisical env refs only)
```

## Principles

- Read-only first: `discovery.yml` runs before any change and must stay check-mode-safe.
- Pinned versions in `inventory/group_vars/all/versions.yml`, each with a source URL.
- Secrets never live here; Infisical is the only secret source (`roles/infisical-agent`).
- `site.yml` performs no mutations until an operator enables a bounded role.
- Rollback: every role change is idempotent and reversible via package removal plus
  config restore from the pre-change discovery report.

## Usage

```
ansible-playbook playbooks/discovery.yml
ansible-playbook playbooks/site.yml
ansible-playbook playbooks/site.yml --limit automation-01 \
  -e '{"fleet_role_enabled":{"base":true}}'
```

Never enable SSH/firewall hardening until key login succeeds from both the
operator workstation and `control_plane`. Keep role enablement host-limited.

## Tests

```
bun test ops/fleet-infra/control-plane.test.ts
ansible-playbook --syntax-check playbooks/site.yml
```
