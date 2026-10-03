# Curated Core delivery — independent archive/source/publication review

Reviewer `/root/review_windows_vault`. Reviewed owner workspace: `/Users/t/Projects/rox-sso-ops-delivery-20261003/deploy/sw/pocket-sso`. This worker changed only review reports/controls in the desktop checkout. Root repaired the delivery helper and recipe after reported findings, and owns delivery/integration. No deployment or image build was performed by this reviewer.

Final source review and independent controls pass. Two destination preservation findings and a recipe default reproducibility finding were reported and fixed by root. No unresolved finding remains in the reviewed helper bytes. Source/evidence hashes are recorded in `pocket-sso-curated-core-independent-review-evidence/sha256.json`.

## Findings and fixes

1. **[P2] Destination publication could replace a concurrently created empty directory.** Original `Path.rename(destination)` checked destination only before reconstruction. A deterministic race control created an owned empty directory just before publication; the helper returned success and replaced its inode. Root now uses macOS `renamex_np(RENAME_EXCL)`, Linux `renameat2(RENAME_NOREPLACE)`, or Windows `os.rename` existing-destination refusal; unsupported hosts fail closed. Fresh Mac control inserts the empty destination after final recipe copy and before native publication: EEXIST, inode unchanged, directory still empty, owned scratch removed.
2. **[P2] Dangling destination symlink redirected reconstruction into its target.** Original full-leaf `.resolve()` accepted an existing dangling symlink and wrote the resolved target. Root now resolves the parent only and rejects `os.path.lexists(destination)`. Fresh control preserves the symlink, leaves its target absent, rejects execution and leaves no temporary context.
3. **[P3] Default Docker recipe did not bind the manifest Node digest.** Original recipe default was a mutable Node tag although the proven build used explicit pinned build arg. Root pinned the recipe default to `node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752` and updated only the recipe hash. No compiled application source changed as part of these helper fixes.

Before controls are retained in `destination-boundaries.log`. Fixed controls are in `destination-fixed-controls.jsonl`.

## Archive and exact source binding

Independent real reconstruction produces exactly **72 files**: **62** frozen baseline files, **9** new files, and one Docker recipe; **3** existing files are modified. No undeclared output file was present. Every unmodified baseline hash is retained. Every baseline hash independently matches Git freeze `1dd7c44ac5f12eacbcc0f2e7c4cc249a30f7e520`; all **12** modified/new source hashes independently match maintained revision `897cf0bcaa59f7a2683ac246dc39a03798b419bb`.

Input mutations of archive, patch, recipe and overlay are rejected before destination publication. Existing nonempty destination is rejected and its sentinel stays unchanged. Forged archive controls recompute only the archive hash/member map to exercise the structural validator beyond the outer digest check: traversal, symbolic-link member and duplicate member are each rejected, with no escape and owned scratch cleanup. Both original and repaired positive/hash controls passed (`controls.json`, `controls-after.json`).

Archive membership equality and regular-file/path checks precede extraction. Baseline byte checks precede patching. Patch/new-file checks and preservation checks precede publication. Root's no-clobber change makes the publication predicate kernel-enforced rather than another user-space exists check.

## Actual native publication and actual image readback

The repaired helper SHA-256 is `886e95e27d5900037e8eff67926be0f3dc569c9b51e0287a50f9fb3804626978`. Full reconstruction and publication-race control ran on macOS using native `renamex_np`. The exact source AST publication block also ran on actual Linux Python in the existing local image `sha256:185e1a7acfa2b7b3105f77a58fef3dc8bd310d5ad0f9a635e209aa4f8e94b1b8`, with network disabled, read-only root filesystem, dropped capabilities and isolated tmpfs. The native `renameat2` control publishes to an absent destination and refuses an existing empty directory, regular file and dangling symlink with EEXIST while preserving both source and destination. This verifies the Linux syscall block; full Linux archive reconstruction was not repeated by this reviewer.

Independently read **all 126 compiled Core/contracts/package file hashes** from both actual local immutable images:

- Curated: `sha256:04948aa150418cad84d216656a7bd925eb0e7d653d356a8e147d6b916a9479b6`.
- Previously tested reference: `sha256:ff33c447ca178c89dac098ec2cd30b2d5ea3c5d1b715beef66b4d0c27f298513`.

Both images match their retained manifests, and those manifests are byte-for-byte identical. Actual Node is **22.22.3**, ABI **127** in both containers. These were network-disabled, read-only ephemeral containers; no new image was pulled, no host service/port was started, and all reviewer-owned containers exited and were removed. Evidence: `actual-curated-image-readback.json`, `actual-reference-image-readback.json`, `linux-publication-controls.jsonl`.

Windows helper publication was reviewed in source but not executed on Windows by this reviewer. The separately verified native DPAPI desktop proof remains in `pocket-sso-native-local-state-repair-evidence/windows-aa80-native/win32.json`; it is unrelated to this Core reconstruction helper. Live service rollout and full end-to-end SSO/billing acceptance remain with root.
