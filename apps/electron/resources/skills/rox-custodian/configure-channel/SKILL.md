---
name: configure-channel
description: Configure and prove a chat channel on the ROX-managed OpenClaw gateway with validated non-interactive writes; secrets only as SecretRefs.
metadata:
  openclaw:
    requires:
      env:
        - OPENCLAW_GATEWAY_TOKEN
    always: true
---

<!--
Port of OpenClaw `custodian-skills/configure-channel/SKILL.md` (port-matrix row
c2.8: "Custodian skills → system agent playbooks"). Clean-room ROX re-expression:
the target is the OpenClaw gateway that ROX itself provisions and owns, not a
user-installed global one.
-->

# Configure a channel

The gateway you are operating is **managed by ROX**: ROX provisions it, owns its
config file, binds it to loopback with token auth, and resolves the `openclaw`
launcher for you. Never invoke a PATH-global `openclaw`, and never hand-edit the
ROX-owned config file — every mutation goes through `openclaw config` so it is
validated. Lifecycle changes (provision / start / stop / security audit) belong
to ROX OpenClaw host control (Settings → Security), not to raw shell commands.

Never print or persist secret values. Channel tokens enter config only as
SecretRefs backed by the ROX credential fabric, or through the in-session
channel-connect flow where the operator types the secret into a masked prompt.

Every run ends with the observable Prove result or an exact explanation of why it
could not be proven.

## Gather

```
openclaw channels list --all
openclaw channels status
openclaw config get channels --json        # "Config path not found" is normal before first setup
```

Confirm the exact config path before writing — key names differ per channel
(`channels.telegram.botToken`, `channels.discord.token`, …):

```
openclaw config schema --json | jq '.properties.channels'
```

Confirm the ROX host-control runtime is running before reading anything else.

## Mutate

Confirm the intended account and access changes with the operator before writing.
Preserve existing approved allowlist entries, `dmPolicy`, and `groupPolicy`
unless their replacement or change is explicitly approved; never broaden access
to make a check pass.

Wire the token through the ROX credential fabric and reference it as a SecretRef
(Telegram example):

```
openclaw config set channels.telegram.botToken --ref-provider default --ref-source env --ref-id TELEGRAM_BOT_TOKEN
```

In-session alternative: use the channel-connect action — the operator enters the
token in a masked prompt, never in chat, and it is stored as a fabric SecretRef.
Avoid `openclaw channels add --token <value>`: it puts the secret in argv and
process listings.

With the bot connected and DM policy `pairing`, ask the operator to DM it, then
read the numeric **Telegram user ID** (never a phone number, username, chat/group
ID, or bot ID) from the pairing reply or from `openclaw logs --follow`
(`senderUserId` in that sender's `telegram pairing request` entry). Stop
following once captured; keep unrelated logs private. If the current policy
prevents this flow, use an already-verified ID or report the discovery blocker —
do not broaden access.

```
openclaw config set channels.telegram.allowFrom '["123456789"]' --strict-json
```

Multi-field changes in one validated write:

```
openclaw config patch --stdin <<'JSON'
{ channels: { telegram: { enabled: true, groupPolicy: "allowlist" } } }
JSON
```

## Repair

```
openclaw doctor --lint
openclaw channels status --probe
```

`doctor --lint` can exit `1` for findings: read the report and continue the
remaining checks. Ordinary `doctor` and `doctor --non-interactive` can write
config/state; do not use them for diagnosis before approval. Apply
`openclaw doctor --fix --non-interactive` only after explicit approval, then
re-check status.

## Prove

Send one real, clearly labeled test message and confirm delivery from the command
result (use `--dry-run` first to inspect the payload):

```
openclaw message send --channel telegram --target <chatId> --message "ROX channel test — please ignore" --dry-run
openclaw message send --channel telegram --target <chatId> --message "ROX channel test — please ignore"
```

If sending fails, report the exact account, permission, destination, or network
blocker without exposing credentials.

## Report

State the channel and account changed, the exact config paths written (never
values), the SecretRef owner, the test destination, and the observed delivery
result. List any remaining operator action.