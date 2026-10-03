# Fresh R15 durable and process-loss verification — 2026-10-01

**PASS on exact source `010fa8c040e3a84cd40cd8195473f52d8582f159`.** This run restores the missing historical raw-log evidence through new actual execution. Checkout `/tmp/rox-r15-durable-recheck-20261001/checkout` is isolated and detached at010; fetched public branch `cloud/all-surfaces-20260930` remains docs head `c31ba50793db9ef676e220054dc3211693a63f3e`. Bun1.3.14 / Node24.19.0.

| Actual invocation | Exit | Pass / fail | Assertions | Files | Seconds | Raw log SHA256 |
|---|---:|---:|---:|---:|---:|---|
| Frozen install | 0 | 1813 packages installed | — | — | 16.637 | `203b839bcf039761930831b8fc658260bb3b3c73e6b5cb8fe528d3397dfc0ee5` |
| Durable | 0 | 1002 / 0 | 7441 | 101 | 9.233 | `49c016f7a8dcb4a1101bd45ac0937e051b052f15464b6f6c6ab960fcd8d9775f` |
| September process-loss | 0 | 24 / 0 | 147 | 4 | 2.011 | `586c2e794c97e9ae3d221fc38d107f709c9dc45c85a22b97a789994262596c31` |

Exact command byte arrays are the existing r19 frozen-install/durable/September commands, recorded in each fresh receipt. Each command now has an actual010 start/end SHA and full raw stdout/stderr retained without a `/tmp` parent-path filter. No old execution outcome was imported. There were zero failed/skipped/todo printed cases.

All six before/after snapshots contain 6180 tracked source files with identical manifest SHA256 `afafaf9499a8f41869f44a5aa057a16d158120480a8a9bac0ba9d6b58d99c415` and lock SHA256 `47a54e33fcd528780b47b62d481b501414a1877c0cc77e5071db76e29297dac1`; checkout statuses stayed clean. Original `/workspace/rox-one` stayed clean at `f63294ba4fffa7238b46b24e918925a313ad0b12` with unchanged lock.

[Actual executed case mapping](executed-cases.json) preserves 1026 observed rows across these two invocations, each with exact actual name, file, source declaration, log line and source SHA256. TypeScript AST matching resolved all rows, including73 template/parameterized rows, with zero fallback/unresolved cases. The count is observed rows, not a unique combined test total. Every mapped source hash and actual raw PASS line was independently matched again by this reviewer.

The durable scope exercises NativeJournal restart/receipt/CAS/prepared recovery, native authority/data RPC, encrypted account-replica recovery, browser key custody, native startup and budget SIGKILL recovery. September executes scheduler SIGKILL effect-before-ACK recovery, budget process ownership/recovery/concurrency, source status and native authorization fences. Names mentioning provider tests or optional skips do not establish live provider acceptance.

Child environments included only necessary PATH/TLS/proxy and isolated config/cache/TMP settings; no provider/OAuth credentials or dotenv were supplied. No configured settings, permissions, network policy, credentials, original source or lock were changed. All own suite processes stopped, and private config/cache/TMP/test data were removed. The clean010 checkout is retained for root publication; this agent made no commit/push/PR changes. No new UI/Electron build was necessary.

**Pending:** full109/full143, UTB/DATA_SHARED full, installed native OS runtime, native Notes mutation UI, live providers, native iOS and security/full DoD. New exact-source durable/process-loss evidence closes this retention gap only. See [fresh-validation.json](fresh-validation.json) for exact commands, artifact hashes, source manifests and cleanup.
