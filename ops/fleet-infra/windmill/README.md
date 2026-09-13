# fleet-infra/windmill

Windmill fleet-maintenance scripts. Each file is a standalone Windmill step
(TypeScript deno or python3) and runs standalone for CI checks. Secrets are
never inline: settings reference Infisical identity environment variables as
`${ENV_NAME}` only (see `settings.example.yml`). All Linux targets are Ubuntu
24.04 hosts from `../inventory/` + `../inventory/host_vars/`. Every script
fails loudly — no swallowed errors.

Copy `settings.example.yml` to `settings.yml` and fill values; `settings.yml`
is local-only.

## Worker-group mapping

| group | workers | purpose |
|---|---|---|
| linux-small | worker-01 | lightweight daily probes |
| linux-heavy | control-01 | compute-heavy jobs |
| browser | control-01 | headless browser workloads |
| omp | control-01 | omp/agent runtime jobs |
| hermes | control-01 | hermes agent jobs |
| mac-arm64 | workstation-local | Apple silicon jobs |
| privileged-ops | control-01 | drain/stop operations |
| backup | observability-01 | restic backup + restore tests |

## Schedules

| script | schedule | worker group |
|---|---|---|
| `fleet_inventory_refresh.ts` | every 6 hours | linux-small |
| `cert_check.ts` | daily | linux-small |
| `disk_cleanup.py` | daily 03:00 | linux-small |
| `restore_test_weekly.py` | weekly Sunday 04:00 | backup |
| `update_report.ts` | weekly Monday 08:00 | linux-small |
| `worker_drain.ts`, `backup_trigger.py`, `failed_unit_remediation.py` | manual / event-driven | privileged-ops / backup / linux-small |

Rollback for any scheduled script = disable its Windmill schedule in the UI
(no code rollback needed).

## Spec → script mapping

| requirement | script |
|---|---|
| SSH BatchMode probe per host from settings hosts list; JSON snapshot path arg; unreachable recorded, not fatal per host | `fleet_inventory_refresh.ts` |
| restic via subprocess with required `RESTIC_*` env; `--check` runs `restic check` | `backup_trigger.py` |
| TLS expiry must exceed 14 days else raise; input domains list | `cert_check.ts` |
| thresholds warn/clean 85/92; journalctl vacuum-size=200M; docker prune `--volumes=false` guarded by clean threshold; apt clean; dry-run default | `disk_cleanup.py` |
| POST Windmill API endpoint env var; graceful stop (drain placeholder + `systemctl stop windmill-worker`); `--resume` counterpart | `worker_drain.ts` |
| parse `systemctl list-units --failed`; allowlist map unit→action restart; unknown units report-only | `failed_unit_remediation.py` |
| markdown table of apt upgradable count + reboot-required per host | `update_report.ts` |
| `restic restore latest` to tempdir, verify marker file, cleanup, write manifest | `restore_test_weekly.py` |

## Local validation

```sh
deno check *.ts                 # TypeScript steps
python3 -m py_compile *.py      # Python steps
```

## Environment variables (all via Infisical identity)

- `WINDMILL_API_ENDPOINT`, `WINDMILL_WORKER_ID`, `WINDMILL_TOKEN` — worker_drain
- `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, optional `RESTIC_AWS_ACCESS_KEY_ID`,
  `RESTIC_AWS_SECRET_ACCESS_KEY` — backup_trigger, restore_test_weekly
