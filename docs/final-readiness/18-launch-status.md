# [PW-STATUS] Integration and first parallel launch

## [PW-STATUS-SOURCE] Source and delivery evidence

The original17 requested PRs and two late arrivals (#1377 and #1384) were independently read back as **MERGED** on GitHub. Their exact original heads are reachable from the observed canonical main. [Remote PR readback](parallel-work/pr-remote-readback.json) preserves states, heads, merge commits and timestamps. Remote promotion was observed during independent local integration; this report does not assign sole authorship for that promotion.

The independently reconciled candidate is `387edc1b1cfec361e2de2196a6963c27a98cbc67`. It includes actual delivered main through `87c1c56ac9243964a296b446a7e03d56236ec676`, desktop0.11.6 and the release pipelines, while preserving the reviewed startup caller fences, sidebar state, tabbed Projects/Roadmap, native authorization/CAS, canonical bounded OMP framing and explicit cancellable online TTS. Final qualification and default-branch delivery are recorded separately in [the integration receipt](parallel-work/pr-integration-receipt.json); historical evidence is not rebound to this revision.

## [PW-STATUS-COUNT] Exact task partition

**625 descriptions =445 executable leaves +180 parent acceptance rollups.** Of the leaves,321 concern UI/services,44 concern the three target products, and80 concern integration/QA/release/recheck. The latter80 are37 integration +31 QA +4 release +8 recheck. The exact requirements and four acceptance fields remain unchanged in [the full launch export](parallel-work/launch-plan.json).

All445 records have one logical owner; allocation is not execution or full acceptance. Actual concurrent capacity here is root plus three workers. The948 UI target activities are repeated target verification of237 leaf IDs, not extra implementation tasks. Existing target runtime availability is conditional;22 environment types still require recorded provisioning evidence. Named signed N/N+1 pairs are explicit outputs of both update packages.

## [PW-STATUS-FIRST-WAVE] Three isolated working lanes

| Lane | Branch | Initial source preparation | Result artifact |
| --- | --- | --- | --- |
| Windows10/11 | `develop/windows-readiness-2026-10-03` | WIN-001.1/.2, WIN-002.1/.2: build/helper manifests and native staging | [Windows first wave](parallel-work/first-wave-windows.json) |
| macOS | `develop/macos-readiness-2026-10-03` | MAC-001.1/.2, MAC-002.1/.2, MAC-003.1/.2: identity/build/native/signing | [macOS first wave](parallel-work/first-wave-macos.json) |
| Hosted Web | `develop/hosted-web-readiness-2026-10-03` | WEB-001.1/.2, WEB-002.1/.2, WEB-003.1/.2: build/identity/operations | [Web first wave](parallel-work/first-wave-web.json) |

These worktrees started from the pinned integrated candidate. Each records source inspection, implemented behavior, concrete remaining patches, code references, full original acceptance and necessary runtime resources. Preparation does not close these16 task DoDs. After promotion, merge the verified main descendant into each branch using the repository's merge policy. No user dirty checkout, profile or runtime data is replaced.

## [PW-STATUS-GAPS] Release gates remain open

- Native Windows10 and11 installed GUI proofs, signing, update interruption/recovery and packaged native loading remain distinct from unit/source checks and CI configuration.
- macOS arm64/Intel runtime closure, minimum declared OS, signing/notarization/stapling, Gatekeeper and installed upgrade need their own evidence. The currently pinned Turso0.7.2 package does not provide the required Darwin x64 native binary; the new release note explicitly lists Intel as unsupported. Completion of MAC-002 must resolve that target dependency before claiming Intel support. [Actual release scope](https://github.com/rox-one/rox-one/blob/87c1c56ac9243964a296b446a7e03d56236ec676/docs/release-0.11.6.md#L10).
- Hosted acceptance requires trusted actor/workspace isolation, HTTPS/WSS, persistent storage and real authenticated browser login/file/reconnect/restart flows. Built WebUI/server, static preview and fixture login are bounded preliminary evidence.
- The source/toolchain/runtime target is qualified Bun1.3.14. Earlier Bun1.4.2 built-server startup failure remains tied to its historical candidate; no new1.4.2 acceptance is implied.
- Fresh GitHub dependency readback after source promotion showed four open High Electron alerts. The two captured Sharp alerts are no longer open after the declared0.35.4 update. This is dependency-alert state, not whole application security or native packaging acceptance; original QA-013 requirements remain unchanged.

## [PW-STATUS-ACCEPTANCE] Launch and handoff criteria

**Requirements:** Preserve all445 original leaf assignments and180 rollups; all three targets start independent preparation; one owner promotes shared-file patches; only actual consumed outputs gate a dependent operation.

**DoD:** Task IDs, counts, four original acceptance fields and pinned source references validate; the19 requested PR states/ancestry are independently read back; all three working branches and bounded first-wave packets exist; final qualified-source and remote delivery receipts are explicit.

**Full functional verification:** Trace every leaf from backlog to owner/contract/resource/target evidence and rollup. Read actual GitHub merged states and main ancestry. Confirm the first-wave branches share the exact accepted application source, preserving separate artifacts and user data. Run final target acceptance only against its actual installed/deployed artifact.

**Test method:** `bun scripts/final-readiness-parallel-plan.ts`; `bun scripts/final-readiness-audit.ts --validate`; exact-head Git ancestry and GitHub API readback; frozen qualified-runtime compiler/build/local-server checks; independent installed Windows/macOS and hosted browser workflows for release acceptance.
