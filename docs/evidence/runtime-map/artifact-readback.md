# R19: actual artifact file readback and answer lineage

Verified `9e4606665` on Linux x64, Bun 1.3.14. The test includes collector/TaskRunner changes from `74f127987` and explicit artifact graph links from `582f51328`.

The production TaskRunner ran the real two-node DAG `artifact-readback` / `artifact-run` in an isolated temporary workspace. Only session execution was injected with deterministic completion messages; task scheduling, interpolation, output persistence, the durable run log, observer enrichment, runtime journal and graph projection were the production implementations.

TaskRunner's atomic writer created `nodes/input.json`, `nodes/report.json` and `nodes/__verdict__.json`. The test read them through both the existing `readNodeOutput` authority and actual filesystem reads. It checked that the report child received the original input through the real dependency interpolation and that the final verification prompt contained the actual report output.

The durable observer captured the exact output readback before asynchronous trace delivery. The recorded report artifact points to the actual relative output file and retains its real child-result evidence ID. The final answer preserves the actual completion message ID `answer-orchestrator`, the exact stored verdict text, artifact IDs and acceptance evidence IDs. A new collector restored all **28 events** without emitting live events; the graph retained explicit child-result → artifact → answer dependency links. No path/text heuristics or synthetic production nodes were used.

The safe receipt is [artifact-readback.json](artifact-readback.json). The actual report file was 76 bytes with SHA-256 `77a16e2137443d61575068137fa07c519702e75f1efdd96861bc90f66a43e637`. Its event IDs and root run ID are included in the receipt. The isolated workspace was removed after verification; its deterministic content and checksum remain reviewable in the receipt.

Command, run from the readback worktree:

```sh
ROX_RUNTIME_ARTIFACT_READBACK_RECEIPT="$PWD/docs/evidence/runtime-map/artifact-readback.json" \
ROX_RUNTIME_ARTIFACT_READBACK_COMMIT=9e4606665 \
/workspace/scratch/d0a9c1c6c094/tooling/node_modules/@oven/bun-linux-x64/bin/bun test \
  packages/server-core/src/sessions/runtime-trace/artifact-readback.test.ts \
  packages/server-core/src/sessions/runtime-trace/conductor.test.ts \
  packages/core/src/runtime-trace/projector.test.ts
```

Result: **exit 0; 22 passed, 0 failed; 115 assertions across 3 files; 484 ms**. The narrow test also preserves exact durable verification and honest missing measurements covered by the existing suites.

Classification: **unit integration with deterministic session execution**, actual filesystem and journal readback. This is not a live-provider or installed-app claim. No provider request, external account connection or user workspace data was involved.
