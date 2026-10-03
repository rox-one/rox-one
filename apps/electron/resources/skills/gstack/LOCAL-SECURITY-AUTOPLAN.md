# ROX local Autoplan security changes

Upstream provenance and licenses remain in this skill pack's lock and notices. These local changes retain the upstream plan lifecycle and native phase-publication contract.

## Descriptor-bound inputs

Alerts **720–727** (`bin/gstack-autoplan-snapshot.ts`) and **710, 718** (the two shipped `autoplan/bin/phase-publication-hook.ts` copies) identified checks of pathname metadata followed by an independent pathname read. Existing content hashes, exact accepted-obligation comparisons, native two-way git links, and initialization rollback checks were meaningful, but did not themselves bind the checked bytes to an opened file.

All snapshot inputs now use an opened regular descriptor with no-follow/nonblocking flags where supported. Bigint device/inode identity retains full-width Windows file IDs. Descriptor and named-file metadata agree before and after a bounded read; size, nanosecond modification/change times, and permissions remain stable. A 32 MiB cap and one extra byte detect growth without an unbounded allocation. Methodology immutability checks use the same descriptor statistics as the bytes. Initial source/destination snapshots likewise bind their saved identity and content. Phase hooks retain strict UTF-8, canonical path, immutable artifact, native transcript, and two-way git link checks.

The original initialization exclusive publication and rollback ownership checks are retained. Hardlinks are intentionally allowed by the reader: initialization temporarily links its own staging files; existing source/active/restore alias checks reject ambiguous input identities. No original plan, restore point, transcript, or shared user state is deleted by these changes. Rollback deletes only its own published restore inode when the active plan has not yet been published.

## Local evidence

`packages/shared/src/skills/__tests__/autoplan-security.test.ts` exercises actual helpers with isolated temporary files:

- Regular data and bigint identity; symlink, directory, FIFO and oversized sparse-file refusal.
- Actual pathname replacement immediately after open and in-place growth during read, both rejected.
- Initialization, exact restore bytes and permissions, repeated initialization, later edits and hardlink-alias refusal.
- A concurrent source edit after restore publication: active remains absent, invocation backup is rolled back, concurrent source bytes survive and staging directories are cleaned up.
- Real methodology preparation, immutable snapshot, exact accepted amendment/readback, writable or edited methodology refusal.
- Native two-way git link acceptance, wrong and symlink backlinks refused; both shipped hook copies stay identical.

These are focused local regression results, not a claim that remote CodeQL has reanalyzed or accepted the candidate. No alert exclusions or query suppressions are added. The filesystem remains under the user's authority: stable descriptor reads and immediate publication guards do not establish immunity against every mutation after a guard returns, nor semantic approval of a plan.
