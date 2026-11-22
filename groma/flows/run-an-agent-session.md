---
type: Groma Flow
title: Run an agent session
groma:
  id: run-an-agent-session
---

The operator opens the desktop workspace and starts an agent session; the renderer forwards the request to the main process, which spawns it on the OMP runtime.

## Steps

| From | To | Action |
| --- | --- | --- |
| [Operator](../actors/operator.md) | [ROX Desktop renderer](../systems/rox-one/containers/desktop-app/components/renderer-browser-toolbar.md) | Opens the workspace and sends a prompt |
| [ROX Desktop renderer](../systems/rox-one/containers/desktop-app/components/renderer-browser-toolbar.md) | [ROX Desktop main](../systems/rox-one/containers/desktop-app/components/main-native-replica.md) | Sends the session request over IPC |
| [ROX Desktop main](../systems/rox-one/containers/desktop-app/components/main-native-replica.md) | [OMP runtime](../externals/omp-runtime.md) | Spawns the agent session over NDJSON RPC |
