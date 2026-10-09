---
name: add-model-provider
description: Add and live-prove a model provider for the ROX-managed OpenClaw gateway with validated config writes, without exposing credentials.
metadata:
  openclaw:
    requires:
      env:
        - OPENCLAW_GATEWAY_TOKEN
---

<!--
Port of OpenClaw `custodian-skills/add-model-provider/SKILL.md` (port-matrix row
c2.8: "Custodian skills → system agent playbooks"). Clean-room ROX re-expression:
the target is the OpenClaw gateway that ROX itself provisions and owns.
-->

# Add a model provider

The gateway you are operating is **managed by ROX**: ROX provisions it, owns its
config file, binds it to loopback with token auth, and resolves the `openclaw`
launcher for you. Never invoke a PATH-global `openclaw`, and never hand-edit the
ROX-owned config file — every mutation goes through `openclaw config` so it is
validated and audited. Lifecycle changes (provision / start / stop / security
audit) belong to ROX OpenClaw host control (Settings → Security).

Never print or persist secret values; credentials enter config only as SecretRefs
backed by the ROX credential fabric (env or file source). Every run ends with the
observable Prove result or an exact explanation of why it could not be proven.

## Gather

```
openclaw config get models --json          # "Config path not found" is normal before first setup
openclaw models list --agent <agentId>     # --agent is required in multi-agent rosters
openclaw models auth list --agent <agentId>
openclaw config schema --json | jq '.properties.models'   # confirm exact provider paths before writing
openclaw plugins list   # some providers need a harness plugin; enable/install NOW, not mid-proof
```

If the harness plugin for the target provider is missing or disabled, remediate
here so the Prove step does not stall on it later. Plugin enablement is part of
the managed runtime's provisioning input — get operator approval and let it be
picked up by gateway hot-reload rather than editing the config file by hand.

Decide the auth contract: API-key providers take a SecretRef on
`models.providers.<id>.apiKey`; subscription/OAuth providers (ChatGPT/Codex,
Claude subscriptions) use `openclaw models auth login --provider <id>` instead
and must not be given an API key path.

## Mutate

API-key example (OpenAI), key staged by the operator in a `0600` file — validate
first with `--dry-run`, then write:

```
openclaw config set secrets.providers.openai_key_file --provider-source file --provider-path /path/to/openai.key --provider-mode singleValue --dry-run
openclaw config set secrets.providers.openai_key_file --provider-source file --provider-path /path/to/openai.key --provider-mode singleValue
openclaw config set models.providers.openai.apiKey --ref-provider openai_key_file --ref-source file --ref-id value
```

Env-var alternative when the ROX credential fabric materializes the key into the
gateway process env:

```
openclaw config set models.providers.openai.apiKey --ref-provider default --ref-source env --ref-id OPENAI_API_KEY
```

To change the default route, use the in-session default-model action (with the
agent id for a non-default agent); it live-tests the route before saving. Do not
change defaults with raw config writes.

## Repair

```
openclaw doctor --lint
```

`doctor --lint` can exit `1` for findings: read the report and continue the
remaining checks. Ordinary `doctor` and `doctor --non-interactive` can write
config/state; do not use them for diagnosis before approval. If a repair is
needed, get explicit approval, run `openclaw doctor --fix --non-interactive`,
then re-run the Gather reads.

## Prove

Roster-safe test (works in every setup; use your own agent id or any configured
agent):

```
openclaw agent --agent <agentId> --model openai/gpt-5.4 -m "Reply with exactly: PROVIDER-PROOF-OK"
```

Single-agent installs can use the lighter completion test instead — it has no
`--agent` flag and fails with "no explicit owner" on multi-agent rosters, so do
not retry it there:

```
openclaw infer model run --gateway --model openai/gpt-5.4 --prompt "Reply with exactly: PROVIDER-PROOF-OK"
```

Expect the exact requested reply; record model id and wall time. If the test
reports the runtime unavailable, the provider's harness plugin is missing: get
approval to add it to the managed runtime's plugin allowlist, restart the
gateway, and test again.

## Report

State the provider added, the SecretRef path written (never the value), the test
result with model id and latency, and whether the default model changed. If the
test failed, report the exact error and the next command to try.