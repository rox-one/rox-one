# [PW-STATUS] Integration and first parallel launch

## [PW-STATUS-SOURCE] Source and delivery evidence

The original17 requested PRs and two late arrivals (#1377 and #1384) were independently read back as **MERGED** on GitHub. Their exact original heads are reachable from the observed canonical main. [Remote PR readback](parallel-work/pr-remote-readback.json) preserves states, heads, merge commits and timestamps. Remote promotion was observed during independent local integration; this report does not assign sole authorship for that promotion.

The frozen independently reconciled application source is `e0740755da02fa31112216b1a32b6d707c3a2cc1`. It includes actual delivered main through `7e24a97cc8bef429d95c9f703420805f9153a99b`, desktop0.11.7 and the release pipelines, while preserving the reviewed startup caller fences, sidebar state, tabbed Projects/Roadmap, native authorization/CAS, canonical bounded OMP framing and explicit cancellable online TTS. Independent integration PR [#1385](https://github.com/rox-one/rox-one/pull/1385) is **MERGED**, merge commit `c5c44f5ae4a347e89f0623d989d136395ac73817`. This delivers the19 requested PRs plus the independent correction/launch package. The final993 head adds reviewed documentation/audit tooling and test-only corrections; product/build/lock bytes remain unchanged since e074. Exact qualification and default-branch readback are in [the integration receipt](parallel-work/pr-integration-receipt.json).

## [PW-STATUS-CHECKS] Current bounded checks

- [UI and allocation receipt](parallel-work/postmerge/e0740755da02fa31112216b1a32b6d707c3a2cc1/surfaces-final/results.json):137 focused tests passed,0 failed,791 assertions;445 unique leaf assignments and1,780 unchanged acceptance fields;16 first-wave IDs and64 unchanged fields.
- [Platform receipt](parallel-work/postmerge/e0740755da02fa31112216b1a32b6d707c3a2cc1/platforms-final/receipt.json):42 updater/packaging/metadata tests passed,0 failed,123 assertions;4 affected module builds;15 product manifests at0.11.7. Voice source bytes remain identical to their previously tested d93 source.
- [Build/runtime receipt](parallel-work/postmerge/e0740755da02fa31112216b1a32b6d707c3a2cc1/services-final/verification.json):fresh Pi and server bundles build successfully. WebUI hit its owned900s timeout; previous WebUI outputs were not accepted as current. The initial fresh-server/fresh-HTML-fixture smoke run had2 passes/2 failures,6 assertions: startup/short-token checks timed out with empty child output and cleanup exit143. Cause is unestablished; host load900+ is an observation, not a passing result or a proved diagnosis. Any subsequent bounded diagnostic is preserved separately and does not overwrite this failed run. Full built-WebUI composed acceptance remains NOT_RUN.
- [Documentation gate](parallel-work/postmerge/e0740755da02fa31112216b1a32b6d707c3a2cc1/document-validation-pass.log):625 task blocks,3,149 pinned references,0 errors. A missing newly written Docker link was detected, corrected to `Dockerfile.server` and the failure retained. Immutable source blobs are read in one Git batch; validation requirements remain unchanged.
- The earlier0.11.6 all-workspace qualification was interrupted when main advanced; completed frozen install and five app typechecks remain in [its partial results](parallel-work/postmerge/387edc1b1cfec361e2de2196a6963c27a98cbc67/results.json). It is not an18/18 pass or a current full CI result.
- **Independent GitHub qualification at the same e074 source:** [validate:ci](https://github.com/rox-one/rox-one/actions/runs/37095251771) passed on its configured Node24/Bun runner. [Actual fresh Pi/WebUI/server builds and lifecycle](https://github.com/rox-one/rox-one/actions/runs/37095251796) passed:4 tests,0 failures,37 assertions. These independent-runner results do not erase the two failed local startup attempts or certify a hosted deployment. The local build/runtime limitations above describe that host.
- [Roadmap caller correction](parallel-work/postmerge/roadmap-ai-caller-fix/results.json):the remaining Linux/macOS SQLite CI failure had3 outdated test-extractor cases that searched the Info page instead of the actual Roadmap page. Production callbacks were present. The test now executes the actual Roadmap callback, retains those3 assertions, adds7 scope/revision/provenance cases and passes10 tests/31 assertions. Product source is unchanged. Related local runtime boundary timeouts remain recorded; the original remote mixed run had199 passes and these3 extraction failures, and must not be described as a fully passing job.
- **Final candidate993 qualification:** [general validate:ci](https://github.com/rox-one/rox-one/actions/runs/37097362176), [Linux and macOS durable runtime](https://github.com/rox-one/rox-one/actions/runs/37097362179), and [fresh built server lifecycle](https://github.com/rox-one/rox-one/actions/runs/37097362159) all passed. [Final check snapshot](parallel-work/github-final-candidate-checks.json) retains exact statuses and links. Native self-hosted jobs remain queued; Vercel reports blocked account deployment. No all-checks-green or final native/hosted release claim is made.

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

[19 — Practical Russian launch assignments](19-start-work.ru.md) adds the concrete first patches, phase requirements/DoDs, resource scheduling and exact351/94 declared-input classification. First-wave evidence remains pinned to387; current0.11.7 source deltas are rechecked before implementation.

## [PW-STATUS-GAPS] Release gates remain open

- Native Windows10 and11 installed GUI proofs, signing, update interruption/recovery and packaged native loading remain distinct from unit/source checks and CI configuration.
- macOS arm64/Intel runtime closure, minimum declared OS, signing/notarization/stapling, Gatekeeper and installed upgrade need their own evidence. The currently pinned Turso0.7.2 package does not provide the required Darwin x64 native binary; the new release note explicitly lists Intel as unsupported. Completion of MAC-002 must resolve that target dependency before claiming Intel support. [Actual release scope](https://github.com/rox-one/rox-one/blob/87c1c56ac9243964a296b446a7e03d56236ec676/docs/release-0.11.6.md#L10).
- The0.11.7 update metadata verifier additionally hardcodes the Mac ARM64 artifact pair; its valid Intel fixture is rejected. The current platform receipt assigns an architecture-aware extension to existing Mac build/native/update/release requirements. Presence of signing credentials still does not prove actual artifact signatures/notarization.
- Hosted acceptance requires trusted actor/workspace isolation, HTTPS/WSS, persistent storage and real authenticated browser login/file/reconnect/restart flows. Built WebUI/server, static preview and fixture login are bounded preliminary evidence.
- The source/toolchain/runtime target is qualified Bun1.3.14. Earlier Bun1.4.2 built-server startup failure remains tied to its historical candidate; no new1.4.2 acceptance is implied.
- Fresh GitHub dependency readback after source promotion showed four open High Electron alerts. The two captured Sharp alerts are no longer open after the declared0.35.4 update. This is dependency-alert state, not whole application security or native packaging acceptance; original QA-013 requirements remain unchanged.
- Full type matrix/CI and reproducible fresh-server startup remain uncleared qualification work. Vite also reported an unreachable duplicate `page-info` case at `apps/electron/src/shared/route-parser.ts:1904`; preserve/retest routing behavior when correcting this existing warning. Resource-bounded incomplete gates do not close QA or release DoD.

## [PW-STATUS-ACCEPTANCE] Launch and handoff criteria

**Requirements:** Preserve all445 original leaf assignments and180 rollups; all three targets start independent preparation; one owner promotes shared-file patches; only actual consumed outputs gate a dependent operation.

**DoD:** Task IDs, counts, four original acceptance fields and pinned source references validate; the19 requested PR states/ancestry are independently read back; all three working branches and bounded first-wave packets exist; final qualified-source and remote delivery receipts are explicit.

**Full functional verification:** Trace every leaf from backlog to owner/contract/resource/target evidence and rollup. Read actual GitHub merged states and main ancestry. Confirm the first-wave branches share the exact accepted application source, preserving separate artifacts and user data. Run final target acceptance only against its actual installed/deployed artifact.

**Test method:** `bun scripts/final-readiness-parallel-plan.ts`; `bun scripts/final-readiness-audit.ts --validate`; exact-head Git ancestry and GitHub API readback; frozen qualified-runtime compiler/build/local-server checks; independent installed Windows/macOS and hosted browser workflows for release acceptance.
