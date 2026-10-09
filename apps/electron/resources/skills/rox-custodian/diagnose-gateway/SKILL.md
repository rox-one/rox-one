---
name: diagnose-gateway
description: Diagnose the ROX-managed OpenClaw gateway, config, secrets, channels, and ports with read-only one-liners.
metadata:
  openclaw:
    requires:
      env:
        - OPENCLAW_GATEWAY_TOKEN
    os:
      - darwin
      - linux
---

<!--
Port of OpenClaw `custodian-skills/diagnose-gateway/SKILL.md` (port-matrix row
c2.8: "Custodian skills → system agent playbooks"). Clean-room ROX re-expression:
the target is the OpenClaw gateway that ROX itself provisions and owns.
The `os` gate is honest: the port audit below uses `lsof`, which is Unix-only.
-->

# Diagnose the gateway

This playbook is read-only: no config writes, no service restarts, no
`doctor --fix`, no killing listeners. Never print secret values; report only
redacted SecretRef owner state. The gateway is **managed by ROX** and always
binds loopback with token auth — treat a non-loopback bind as a finding, not a
convenience.

Every run ends with the observable Prove result or an exact explanation of why it
could not be proven.

## Gather

```
openclaw doctor --lint
openclaw gateway status --deep
openclaw config validate
openclaw channels status
openclaw models status
openclaw channels logs --channel <id>
```

`doctor --lint` is read-only and can exit `1` for findings: read the report and
continue the remaining checks. Do not substitute ordinary `doctor` or
`doctor --non-interactive`; they can copy legacy config and migrate state without
`--fix`.

Read the ROX host-control runtime state and its last health result from ROX
OpenClaw host control (Settings → Security); the managed runtime also exposes a
loopback `/health` probe. On managed installs, read bounded recent gateway logs
from the log path the runtime prints at startup.

Check these signatures without guessing:

- invalid config or schema errors (`config validate` names the exact key and line);
- degraded SecretRef owners — report the owner, never ids or values;
- expired or rejected channel authentication (`channels status` per account);
- `EADDRINUSE`, a second gateway listener, or a service/config port mismatch
  (`lsof -nP -iTCP:<port> -sTCP:LISTEN`);
- gateway crash loops: read the last startup stack in the gateway log; a
  schema-valid config that still crashes startup is a bug — capture the stack and
  report it.

Correlate timestamps and identify the first owner-boundary failure.

## Mutate

Nothing. Do not change config, migrate state, or alter services. Diagnostic
commands may still produce incidental logs or cache bookkeeping.

## Repair

Translate each finding into the next action, naming the responsible skill when
one exists: `configure-channel` or `add-model-provider`. For lifecycle or
provisioning faults (runtime missing, provisioning rejected, port block
conflict), the action is a ROX host-control operation with operator approval, not
a raw command. Recommend `openclaw doctor --fix --non-interactive` only as a
separately approved step.

## Prove

Repeat the smallest read-only check that exposes the condition and record its
output, for example:

```
openclaw gateway status --deep
openclaw channels status --probe
```

If access, logs, or the gateway are unavailable, report that exact blocker rather
than declaring a cause.

## Report

Findings in causal order with evidence for each; current gateway/config/SecretRef
/channel/port state; one recommended next skill or operator action. State
explicitly that no config/service repairs or state migrations were performed.