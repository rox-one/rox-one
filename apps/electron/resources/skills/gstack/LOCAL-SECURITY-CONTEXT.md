# ROX Graphify / GBrain file-boundary patches

These local patches preserve the helper interfaces and source attribution/policy
checks. They do not invoke a real GBrain service or use host credentials in tests.

| CodeQL alert | Boundary and local disposition |
| --- | --- |
| 769 | Graphify display-only status parses graph JSON through `readBoundedStable`, capped at 5 MiB. The preceding size check is cosmetic; it no longer authorizes an unbounded pathname read. Large graphs retain the existing “node count skipped” display. |
| 787 | Secret-scan report uses `readBoundedStable` with a 16 MiB cap. Oversize, symlink, descriptor replacement or unstable files produce `scanner: error`; they cannot be treated as scanned/clean. |
| 728, 729 | GBrain source pin and verified sync state use stable descriptor reads capped at 512 bytes and 64 KiB. Unverifiable files return `unknown` before invoking the external GBrain CLI. |
| 731, 732 | Sync lock/dream-marker cleanup reads bounded regular files using the same descriptor helper (4 KiB). Linked, oversized, malformed or unstable files are left intact. Existing PID ownership checks still precede unlink; cleanup remains best effort for cooperating local processes, not an atomic lock implementation against a hostile process with the same user privileges. |
| 734, 736 | Memory ingest reads one stable source snapshot for rendered body, provenance hash, size and optional scan fingerprint. A 64 MiB ceiling retains full-file hashing/tail-edit detection for documented realistic (~50 MiB) transcripts; larger files fail parsing rather than truncate/advance state. Allocation is bounded by the observed source size and that ceiling. |
| 735 | Import-failure tail opens with no-follow/nonblocking flags, verifies a regular nonlinked descriptor/current inode, reads only the selected appended range with a 16 MiB cap and verifies stability afterwards. Unsafe/unverifiable output leaves all staged sources eligible for retry. An absent log retains the no-failures behavior. |

`readBoundedStable` is the existing gstack descriptor reader. The new
`readBoundedRangeStable` preserves positional tail reads without loading old log
history. Both reject symlinks/hardlinks and descriptor/path replacement; the
range helper also rejects truncation after the offset was captured.

Regression:

```sh
bun test packages/shared/src/skills/__tests__/gstack-boundaries.test.ts
```

Fixtures exercise real Graphify status, real capability CLI in an isolated git
repository, marker cleanup in a temporary state root, private fake-scanner
reports, source/provenance consistency and descriptor replacement/growth races.
No exclusions or CodeQL suppression were added. Fresh remote analysis is required
before reporting these findings as scanner-resolved.
