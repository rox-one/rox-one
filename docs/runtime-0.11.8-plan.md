# Runtime delivery task graph

Current checkout: `/Users/t/Projects/rox-release-20261003`, branch `release/desktop-runtime-20261003`, integration PR #1392. The original dirty `rox-one` checkout and existing application data are preserved.

| Task | Owner | Owned files | Dependencies | Verification | State |
|---|---|---|---|---|---|
| Restore/branch lifecycle | history + lead | OMP history/agent and resume-history modules | native 18.4.12 protocol | regression, actual native CLI restart/fork probe | implemented; source/native probe verified; installed UI pending |
| Mandatory session and worker magic policy | history + lead | backend policy, SessionManager, worker extension | OMP configuration | parent → task → restricted child → yield actual SDK loop; model max acknowledgement | implemented and source/native SDK verified on raw text, images, native slash/skill, steer/followUp and restricted child routes; installed provider acceptance pending |
| Requested skill corpus and first-run discovery | skills | resources/skills, bundled synchronizer, private OMP profile | pinned upstreams/licenses | 34 packs, 330 unique SKILL.md, 39 requested names; isolated native discovery | implemented; frozen provenance and 330 discovery verified |
| Context/migration/branding | context + lead | context-docs, config migration, package/build namespaces | copy-only compatibility rules | preserved conflicts/credentials, source paths, fixture regression | implemented and source verified |
| Vendor browser/document boundaries | lead | Impeccable/oh-my-agent helpers | scanner triage | VM window/origin negative controls, secure randomness, descriptor transformation | db1906fd2; 6 tests / 20 assertions passed |
| Vendor HTML/filesystem helpers | skills | gstack shared helpers + PDF/CSO | parser dependency and review | malformed HTML/SVG, secure IO, per-alert disposition | implemented; frozen source inventory verified |
| Vendor Compound and graph/memory helpers | context | Compound local servers, gstack graph/gbrain | descriptor interfaces | actual loopback HTTP auth/path checks; bounded descriptor regressions | 64ac317d9 and 6cf004168; passed |
| Vendor browse/design/iOS/snapshot helpers | history | assigned disjoint gstack helpers | shared secure IO | focused regressions and per-alert source evidence | committed; source regressions passed |
| Provenance aggregation | skills single writer | SKILLS.lock, vendor patches/notices | all owners committed | source hashes, licenses, 330 discovery and user policy preservation | 1b20d0b99 frozen; 382 findings reviewed, fresh remote closure pending |
| Independent integrated review | context | read-only source and tests | committed patches | concrete failure reproduction | active |
| Remote validation and both packages | lead | release workflow + integrated revision | final provenance/source | exact HEAD full typecheck/runtime gates, macOS/Windows packaging, fresh scanner findings | previous 2af candidate passed builds; security failed; fresh candidate pending |
| Main integration and release readback | lead | PR/main, tagged release, publisher | accepted remote candidate | exact ancestry, artifact SHA256, feed SHA512, asset remote digest | pending |
| Latest Mac install and native acceptance | lead | /Applications/Rox.app and isolated test session | published verified Mac ZIP | backup, version/skills readback, actual UI response, branch marker isolation, quit/relaunch history | pending; installed version remains 0.11.7 |

## Delivery boundaries

Unsigned macOS packages support explicit metadata-only checks and the GitHub release download page. Native automatic installation still requires valid Apple signing credentials. Windows x64 packaging is covered by hosted CI; Windows native UI cannot be accepted on this Mac host.

No CodeQL exclusions are introduced. Each new vendor finding is fixed, removed with an unused test runner, or explicitly reviewed against actual helper behavior. Scanner results and manual source review remain distinct evidence.

## Continuity

Revision-bound probes live in `docs/evidence/`; the native task checkpoint is maintained under `~/Obsidian/Brain/Agents/Sessions/checkpoints/`. No `.codegraph/` was found in this checkout; targeted source searches were used. All owner handoffs include exact commits and functional regression commands. The checkpoint records context and does not imply a background execution receipt.
