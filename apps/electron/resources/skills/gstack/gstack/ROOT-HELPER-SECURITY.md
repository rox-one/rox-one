# ROX helper filesystem review

| CodeQL alert | Local fix | Functional proof |
| --- | --- | --- |
| 799, Codex overlap preflight | Ownership classification reads one bounded regular descriptor. Uncertain existing content is protected as user-owned; an absent skill remains absent. | Generated/user/missing/linked skill fixtures. |
| 768, Claude skill migration | Source and preserved-file comparisons use stable bounded reads. Copy publication uses exclusive private temporary files and atomic replacement, preserving source mode. Canonical source resolution preserves legitimate source aliases. | Actual shipped copy function executed against a linked destination; victim unchanged, mode preserved, no temporary file leak. |
| 764, timeline stop hook | Tail reads use bounded stable descriptor ranges; completion append uses the shared secure descriptor writer, tightening private permissions and refusing links/hardlinks. | Actual shipped tail function exercised with partial first line and linked input; private append behavior covered by shared helper tests. |
| 730, design engine identity | Identity hashes bytes and size of one opened regular descriptor with final identity/stability checks. Verified engine install uses exclusive atomic publication. | Actual shipped identity function exercised with normal binary, symlink and replacement immediately after open. |
| 733, office-hours review | Saved prompt/design/report reads use stable bounded descriptors; existing prompt shape and atomic publication checks retained. | Actual prepare CLI creates 0600 prompt and rejects linked evidence without touching victim. |

No CodeQL exclusion or dismissal is introduced by these edits. Fresh remote analysis must establish closure separately. Bounds: skills 4 MiB, migration assets 64 MiB, review documents 16 MiB; timeline retains its existing 256 KiB tail window.
