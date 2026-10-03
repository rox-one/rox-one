# [PW] Parallel launch plan: all product targets and exact task ownership

This plan schedules the audited work; it does not declare445 tasks completed or445 executors running. Source and runtime progress must be re-evaluated against the actual integrated revision in [the PR integration receipt](parallel-work/pr-integration-receipt.json). Historical source evidence remains bound to its original commit.

## [PW-COUNT] Exact count without double-counting

**625 descriptions =445 executable leaves +180 parent acceptance rollups.** There are182 parent-marked records and443 subtask-marked records; standalone `QA-012` and `INT-018` are leaves even though they have no parent. Parent breadth, combinations and full DoD still require proof. Implementation, unit tests and four target lanes reuse the same leaf ID.

| Family | Descriptions | Rollups | Executable leaves |
| --- | ---: | ---: | ---: |
| UI | 318 | 81 | 237 |
| SVC | 126 | 42 | 84 |
| WIN | 21 | 7 | 14 |
| MAC | 18 | 6 | 12 |
| WEB | 27 | 9 | 18 |
| INT | 54 | 17 | 37 |
| QA | 43 | 12 | 31 |
| REL | 6 | 2 | 4 |
| RECHECK | 12 | 4 | 8 |

Full machine-readable dispatch: [445 leaves, exact owners, code references, requirements, DoD and tests](parallel-work/launch-plan.json). Backlog input SHA-256: `3636590835be9758571fcf5b68132d074566a52856e88cc2ac18c904804deb06`.

## [PW-LAUNCH] Start now

1. Root integrates the17 captured open PR heads without dropping either side's behavior; records changed contracts, focused tests and remote merged states. Integration has a single promotion owner. Draft status alone is not a product defect; qualify substantive changes before publishing.
2. Launch Windows, macOS and hosted Web source/build/environment work simultaneously. They consume the same versioned shared contracts and can build separate preliminary artifacts immediately. No target waits for another target to finish.
3. Launch the84 service leaves and237 UI leaves in isolated source branches, bounded by actual executor capacity. Probe existing implementations first; finish the remaining requirements instead of rewriting features already delivered by PRs.
4. Launch37 integration leaves and47 QA/release/recheck leaves: scenarios, fixtures, CI, typecheck repairs, accessibility, security and recovery work start now. Actual composed acceptance consumes concrete outputs as they become available.
5. Provision GUI machines, signing, provider sandboxes, staging TLS/storage and target browsers concurrently; a missing environment delays its specific runtime proof only.
6. Review dirty Compound/OMP/sidebar work read-only; capture exact deltas and adopt reviewed changes into isolated branches. Existing user worktrees and active data remain preserved.

**Dispatch mechanics:** one root integrator plus three active worker slots in this session. Initially assign workers to (a) Windows build/native/install, (b) macOS build/native/signing and (c) hosted Web build/identity/ops; root promotes scoped patches and runs integration gates. Rotate finished or externally blocked workers to the next ready leaf. More workers/runners may expand independent domain lanes; capacity is not inferred from task count. Each assignment records source SHA, leaf IDs, owner, allowed paths, contract inputs, artifact directory and exact acceptance commands. Shared-file owners promote bounded patches; consumers may continue in separate worktrees.

## [PW-TARGETS] All target lanes start in parallel

| Package | Owner | Exact leaf IDs | Initial outputs / gate scope |
| --- | --- | --- | --- |
| P-WIN-BUILD: Windows reproducible bundling and fresh helper staging | windows-build | WIN-001.1, WIN-001.2 | win.main-preload-bundles; win.generated-helper-manifest; win.unsigned-installer |
| P-WIN-NATIVE: Windows native dependency and clean runtime closure | windows-native | WIN-002.1, WIN-002.2 | win.native-dependency-manifest; win.native-load-receipt |
| P-WIN-INSTALL: Windows identity, launcher and retention policy | windows-installer | WIN-003.1, WIN-003.2 | win.installer-and-data-policy; win.migration-and-retention-receipt |
| P-WIN-UPDATE: Windows signing, owned feed and interruption recovery | windows-update | WIN-004.1, WIN-004.2 | win.signed-artifacts; win.update-transition-receipt; win.publishable-feed-set |
| P-WIN-MEDIA: Windows executable discovery, shell and documents | windows-media | WIN-005.1, WIN-005.2 | win.media-document-runtime-contract; win.real-asr-document-receipt |
| P-WIN-SIDECAR: Windows native capability negotiation and optional transport | windows-sidecar | WIN-006.1, WIN-006.2 | windows-native-support-decision; win.native-capability-contract; win.sidecar-release-or-supported-fallback |
| P-WIN-UX: Installed Windows callbacks and desktop UX | windows-ux | WIN-007.1, WIN-007.2 | win.callback-and-desktop-ux-receipt |
| P-MAC-NAMES: macOS bundle/DMG/icon name repair | mac-artifacts | MAC-001.1, MAC-001.2 | mac.bundle-name-contract; mac.named-unsigned-artifacts |
| P-MAC-NATIVE: macOS architecture-specific native dependency staging | mac-native | MAC-002.1, MAC-002.2 | mac.native-dependency-manifests; mac.native-load-receipts |
| P-MAC-SIGN: macOS signing, notarization and minimum-OS entitlements | mac-signing | MAC-003.1, MAC-003.2 | mac.signed-notarized-artifacts; mac.minimum-os-entitlement-receipt |
| P-MAC-UPDATE: macOS complete update set and flush/relaunch | mac-update | MAC-004.1, MAC-004.2 | mac.complete-update-set; mac.update-transition-receipts |
| P-MAC-PERMISSIONS: macOS permission recovery and Finder runtime bootstrap | mac-runtime-permissions | MAC-005.1, MAC-005.2 | mac.permission-and-clean-bootstrap-receipts |
| P-MAC-LIFECYCLE: Optional macOS native sidecar and application lifecycle | mac-lifecycle | MAC-006.1, MAC-006.2 | mac.sidecar-release-or-supported-exclusion; mac.dock-window-sleep-quit-receipts |
| P-WEB-BUILD: Hosted container/standalone build and runtime pins | web-build | WEB-001.1, WEB-001.2 | web.deployable-image-and-runtime-manifest; web.standalone-delivery-manifest |
| P-WEB-IDENTITY: Hosted principal/workspace enforcement and logout | web-identity | WEB-002.1, WEB-002.2 | web.principal-and-workspace-contract; web.auth-revocation-receipt |
| P-WEB-OPS: Hosted HTTPS/WSS ingress and durable state | web-operations | WEB-003.1, WEB-003.2 | web.running-https-wss-deployment; web.durable-volume-contract |
| P-WEB-FILES: Browser byte-preserving files, preview and download | web-files | WEB-004.1, WEB-004.2 | web.file-byte-and-resource-contract; web.complete-file-journey-receipt |
| P-WEB-NAV: Workspace-aware URLs/tabs and truthful capabilities | web-navigation | WEB-005.1, WEB-005.2 | web.navigation-capability-contract; web.navigation-and-refusal-receipt |
| P-WEB-AUTH-NOTIFY: Hosted provider auth and notification permission/clicks | web-auth-notifications | WEB-006.1, WEB-006.2 | web.provider-auth-and-notification-receipt |
| P-WEB-MEDIA: Browser capture and hosted interactive browser runtime | web-media-browser | WEB-007.1, WEB-007.2 | web.capture-and-hosted-audio-receipt; web.remote-browser-interaction-receipt |
| P-WEB-RECOVERY: Actual error boundary, authenticated readiness and browser certification | web-recovery | WEB-008.1, WEB-008.2 | web.error-and-ready-contract; web.browser-engine-surface-receipts |
| P-WEB-VIEWER: Separate viewer API deployment and safe transcript rendering | viewer-sharing | WEB-009.1, WEB-009.2 | viewer.deployed-share-api; viewer.create-reload-revoke-redaction-receipt |
| G-CI: Exact workflow coverage, qualified Bun and receipt attribution | ci-toolchain | QA-001.1, QA-001.2, QA-011.1, QA-011.4, QA-012 | supported-bun-build-runtime-policy; all-workspace-target-ci-contract; ci-command-revision-scope-receipts |
| G-TYPES: Residual viewer/gateway type repair and independent workspace qualification | types-contracts | QA-010.1, QA-010.2, QA-011.2, QA-011.3 | viewer-compatible-build; messaging-gateway-compatible-type-graph; all-workspace-typecheck-receipt |
| G-HARNESS: Isolated real UI journeys and alternate-state harness | qa-real-ui | QA-002.1, QA-002.2, QA-003.1, QA-003.2 | isolated-real-ui-harness; real-journey-and-variant-receipts |
| G-ACCESSIBILITY: Native assistive technology and twelve-locale flows | qa-accessibility | QA-004.1, QA-004.2 | accessibility-and-locale-receipts |
| G-PERFORMANCE: Installed release and hosted performance budgets | qa-performance | QA-005.1, QA-005.2 | release-and-hosted-performance-receipts |
| G-SECURITY: Electron/Sharp advisory resolution and target attack boundaries | qa-security-runtime | QA-006.1, QA-006.2, QA-013.1, QA-013.2, QA-013.3, QA-013.4, QA-013.5, QA-013.6 | dependency-and-runtime-selection; electron-sharp-security-disposition; target-boundary-security-receipts |
| G-DATA-RECOVERY: Profile/server backup and failure recovery | qa-data-recovery | QA-007.1, QA-007.2 | backup-and-failure-recovery-receipts |
| G-INSTALL-UPGRADE: Independent clean-machine install/update/removal acceptance | qa-installation | QA-008.1, QA-008.2 | independent-install-upgrade-retention-receipts |
| G-OPERATIONS: Health/readiness, diagnostics and supervised restart | qa-service-operations | QA-009.1, QA-009.2 | service-health-and-restart-receipts |
| G-SUPPLY: Immutable artifact SBOM, licenses and protected publication | release-supply-chain | REL-001.1, REL-001.2 | accepted-exact-artifact-sbom; artifact-provenance-and-publication-policy |
| G-RUNBOOKS: Verified user setup and hosted operator runbooks | release-runbooks | REL-002.1, REL-002.2 | verified-user-and-operator-runbooks |
| G-SOURCE-CLOSURE: Branch/dirty/remote evidence and requirement closure registry | release-source-closure | RECHECK-001.1, RECHECK-001.2, RECHECK-004.1, RECHECK-004.2 | task-output-evidence-matrix; source-dirty-remote-reconciliation |
| G-FINAL-CANDIDATE: Frozen native artifacts and real hosted deployment recheck | release-candidate-verification | RECHECK-002.1, RECHECK-002.2 | frozen-candidate-target-acceptance |
| G-INDEPENDENT-SIGNOFF: Fixture audit and final genuine regression/usability sweep | release-independent-review | RECHECK-003.1, RECHECK-003.2 | independent-release-signoff |

[Platform allocation](parallel-work/platform-plan.json) includes source references, full per-leaf acceptance, shared files, output-phase dependencies and22 environment types to provision independently. Windows10 and11 need separate installed GUI receipts. macOS arm64/Intel and the declared minimum OS need recorded runtime evidence. Signing/notarization/updates require real identities and actual artifact bytes. Hosted Web requires an authenticated server, HTTPS/WSS, persisted storage and real browser workflows; a static renderer or HTTP200 does not close its DoD.

**Hosted identity decision:** use isolated account/workspace authorization as the planning assumption; personal hosted mode may reuse the same explicit ownership contract. Confirm the product mode before committing a new identity schema. Source/build/browser adapter and staging preparation can proceed independently.

## [PW-DOMAINS] Services and microservices

Both leaves in each domain envelope can begin in parallel in isolated branches. Shared protocol/auth/SQLite/secrets/process/version files have one promotion owner. Existing contract fixtures allow consumer implementation before producer changes are complete.

| Domain envelope | Leaf IDs | Shared contract owners |
| --- | --- | --- |
| WP-SVC-001: Server configuration and public origin | SVC-001.1, SVC-001.2 | C-CFG |
| WP-SVC-002: Hosted authentication and route isolation | SVC-002.1, SVC-002.2 | C-AUTH, C-RPC |
| WP-SVC-003: Transport compatibility and capabilities | SVC-003.1, SVC-003.2 | C-RPC |
| WP-SVC-004: Agent executable and model delivery | SVC-004.1, SVC-004.2 | C-RUNTIME, C-CFG |
| WP-SVC-005: OMP tool and branch contracts | SVC-005.1, SVC-005.2 | C-OMP, C-RPC, C-AUTH |
| WP-SVC-006: Pi process and retrieval services | SVC-006.1, SVC-006.2 | C-PROCESS, C-RUNTIME |
| WP-SVC-007: MCP/source connections | SVC-007.1, SVC-007.2 | C-SOURCE, C-SECRET |
| WP-SVC-008: Standalone session MCP | SVC-008.1, SVC-008.2 | C-SOURCE, C-SECRET, C-RPC |
| WP-SVC-009: Credential custody and grant imports | SVC-009.1, SVC-009.2 | C-SECRET |
| WP-SVC-010: Runtime secret boundaries | SVC-010.1, SVC-010.2 | C-SECRET, C-PROCESS |
| WP-SVC-011: OAuth transactions and origins | SVC-011.1, SVC-011.2 | C-SECRET, C-CFG, C-AUTH |
| WP-SVC-012: Cloud execution outcomes | SVC-012.1, SVC-012.2 | C-CLOUD, C-BUDGET |
| WP-SVC-013: Daytona entitlement and image | SVC-013.1, SVC-013.2 | C-CLOUD, C-SECRET |
| WP-SVC-014: Local/cloud run persistence | SVC-014.1, SVC-014.2 | C-PROCESS, C-CLOUD, C-SQL |
| WP-SVC-015: Legacy Cloudflare disposition | SVC-015.1, SVC-015.2 | C-CLOUD, C-AUTH |
| WP-SVC-016: Messaging common gateway | SVC-016.1, SVC-016.2 | C-MSG, C-AUTH, C-PROCESS |
| WP-SVC-017: Telegram adapter | SVC-017.1, SVC-017.2 | C-MSG, C-SOURCE |
| WP-SVC-018: WhatsApp worker | SVC-018.1, SVC-018.2 | C-MSG, C-PROCESS, C-SECRET |
| WP-SVC-019: Discord worker | SVC-019.1, SVC-019.2 | C-MSG, C-PROCESS, C-AUTH |
| WP-SVC-020: Lark adapter | SVC-020.1, SVC-020.2 | C-MSG, C-SECRET |
| WP-SVC-021: WeChat/iLink adapter | SVC-021.1, SVC-021.2 | C-MSG, C-SECRET, C-PROCESS |
| WP-SVC-022: Automation effects and script processes | SVC-022.1, SVC-022.2 | C-EFFECT, C-PROCESS, C-SECRET |
| WP-SVC-023: Scheduler and workflow receipts | SVC-023.1, SVC-023.2 | C-EFFECT, C-SQL, C-NATIVE |
| WP-SVC-024: Knowledge kernel and vault mutations | SVC-024.1, SVC-024.2 | C-RUNTIME, C-PROCESS, C-NATIVE |
| WP-SVC-025: Memory search and ownership | SVC-025.1, SVC-025.2 | C-SQL, C-AUTH, C-NATIVE |
| WP-SVC-026: Mail provisioning and JMAP | SVC-026.1, SVC-026.2 | C-AUTH, C-SECRET, C-EFFECT |
| WP-SVC-027: Account replicas | SVC-027.1, SVC-027.2 | C-AUTH, C-NATIVE, C-SQL, C-SECRET |
| WP-SVC-028: Organizations and remote team sync | SVC-028.1, SVC-028.2 | C-AUTH, C-NATIVE |
| WP-SVC-029: Session sharing and presence | SVC-029.1, SVC-029.2 | C-AUTH, C-RPC |
| WP-SVC-030: Marketplace trust and installs | SVC-030.1, SVC-030.2 | C-MARKET, C-RUNTIME |
| WP-SVC-031: Projects and portable resources | SVC-031.1, SVC-031.2 | C-AUTH, C-NATIVE, C-SOURCE |
| WP-SVC-032: Pages/custom views | SVC-032.1, SVC-032.2 | C-SOURCE, C-AUTH, C-RPC |
| WP-SVC-033: Code intelligence and SBOM | SVC-033.1, SVC-033.2 | C-SOURCE, C-RUNTIME, C-AUTH |
| WP-SVC-034: Local environment and Git | SVC-034.1, SVC-034.2 | C-CFG, C-PROCESS, C-SOURCE |
| WP-SVC-035: Privileged command gateway | SVC-035.1, SVC-035.2 | C-AUTH, C-PROCESS, C-SECRET |
| WP-SVC-036: Rewards and balance | SVC-036.1, SVC-036.2 | C-AUTH, C-SQL, C-PRIVACY |
| WP-SVC-037: OpenClaw process/audit runtime | SVC-037.1, SVC-037.2 | C-PROCESS, C-RUNTIME, C-SECRET |
| WP-SVC-038: Native document authority and journal | SVC-038.1, SVC-038.2 | C-AUTH, C-NATIVE, C-SQL |
| WP-SVC-039: Provider budget ledger | SVC-039.1, SVC-039.2 | C-BUDGET, C-SQL, C-EFFECT |
| WP-SVC-040: Cross-runtime SQLite | SVC-040.1, SVC-040.2 | C-SQL, C-RUNTIME |
| WP-SVC-041: Voice and privacy consent | SVC-041.1, SVC-041.2 | C-PRIVACY, C-RUNTIME, C-SECRET |
| WP-SVC-042: Browser profile credential custody | SVC-042.1, SVC-042.2 | C-AUTH, C-SECRET, C-SQL |

[Service/integration allocation](parallel-work/service-plan.json) lists42 domain envelopes,84 independent service lanes,37 integration leaves,16 shared contract owners and22 consumed-output edges. OMP decoder/branch handling, RPC shapes, authority, credentials, migrations and native custody require exact contract compatibility; they do not impose a blanket service-before-UI schedule.

## [PW-SURFACES] Every screen/function/module

[Surface allocation](parallel-work/surface-plan.json) gives237 individually assigned UI leaves across81 surface owners, including exact paths, code references through the full dispatch export, native/browser prerequisites and full original acceptance. Each starts with source inspection, isolated patch, component/negative/race tests and fixture preparation. Four target activities per UI leaf produce948 verification activities; these are not948 additional tasks.

| Surface owner | Parent scope | Leaf IDs |
| --- | --- | --- |
| ROLLUP-UI-001 | Workbench shell, routes and window layouts | UI-001.1, UI-001.2 |
| ROLLUP-UI-002 | Onboarding, provider setup and reauthentication | UI-002.1, UI-002.2 |
| ROLLUP-UI-003 | Home dashboard and every registered widget | UI-003.1, UI-003.2, UI-003.3, UI-003.4, UI-003.5, UI-003.6, UI-003.7, UI-003.8, UI-003.9, UI-003.10, UI-003.11, UI-003.12, UI-003.13, UI-003.14, UI-003.15, UI-003.16, UI-003.17, UI-003.18, UI-003.19, UI-003.20, UI-003.21, UI-003.22 |
| ROLLUP-UI-004 | Session lists, collections, Kanban and batch actions | UI-004.1, UI-004.2 |
| ROLLUP-UI-005 | Chat transcript, composer and rich session views | UI-005.1, UI-005.2 |
| ROLLUP-UI-006 | Branching, rewriting, side threads and session workbench | UI-006.1, UI-006.2 |
| ROLLUP-UI-007 | Permission, credential, admin approval and source authentication dialogs | UI-007.1, UI-007.2 |
| ROLLUP-UI-008 | Personal tasks, scheduling, lists and task detail | UI-008.1, UI-008.2 |
| ROLLUP-UI-009 | Task delegation and agent task projections | UI-009.1, UI-009.2 |
| ROLLUP-UI-010 | Notes documents, folders, assets and Markdown editor | UI-010.1, UI-010.2 |
| ROLLUP-UI-011 | Notes Base/Table, JSON Canvas, Outline, Graph and mind map | UI-011.1, UI-011.2 |
| ROLLUP-UI-012 | Note AI, comments, wiki links and vault insights | UI-012.1, UI-012.2 |
| ROLLUP-UI-013 | Unified Inbox, review actions and attention state | UI-013.1, UI-013.2 |
| ROLLUP-UI-014 | Inbox mail accounts, folders, message rendering and composition | UI-014.1, UI-014.2 |
| ROLLUP-UI-015 | Feed agents, automation activity, news, subscriptions and source editor | UI-015.1, UI-015.2 |
| ROLLUP-UI-016 | Local Meetings recording, imports, ASR and follow-up outputs | UI-016.1, UI-016.2 |
| ROLLUP-UI-017 | Meeting workspace, agent readiness and proposal inbox | UI-017.1, UI-017.2 |
| ROLLUP-UI-018 | Memory manager, injection meter and lesson provenance | UI-018.1, UI-018.2 |
| ROLLUP-UI-019 | Automation editor, graph, schedules and execution history | UI-019.1, UI-019.2 |
| ROLLUP-UI-020 | Projects home, creation, detail, assets and settings | UI-020.1, UI-020.2 |
| ROLLUP-UI-021 | Sources catalog, MCP tools, permissions and source detail | UI-021.1, UI-021.2 |
| ROLLUP-UI-022 | Skills catalog, OMP imports, editing and invocation | UI-022.1, UI-022.2 |
| ROLLUP-UI-023 | Connections hub, imports, credentials, grants and audit | UI-023.1, UI-023.2 |
| ROLLUP-UI-024 | Knowledge search, saved views and entity inspector | UI-024.1, UI-024.2 |
| ROLLUP-UI-025 | Knowledge proposals and diff review | UI-025.1, UI-025.2 |
| ROLLUP-UI-026 | Optional knowledge engine and embedded SiYuan surface | UI-026.1, UI-026.2 |
| ROLLUP-UI-027 | Browser pane, profiles, navigation and inspector browser | UI-027.1, UI-027.2 |
| ROLLUP-UI-028 | Embedded extension views and extension host integration | UI-028.1, UI-028.2 |
| ROLLUP-UI-029 | Terminal route, dock and genuine interactive shell | UI-029.1, UI-029.2 |
| ROLLUP-UI-030 | Cloud-run detail surface and live run operations | UI-030.1, UI-030.2 |
| ROLLUP-UI-031 | Generated Pages catalog, page runtime and capability grants | UI-031.1, UI-031.2 |
| ROLLUP-UI-032 | Page publication, session sharing and publish dialogs | UI-032.1, UI-032.2 |
| ROLLUP-UI-033 | Team activity, invitations and workspace transfers | UI-033.1, UI-033.2 |
| ROLLUP-UI-034 | Dossier contacts, companies, touches and generated briefs | UI-034.1, UI-034.2 |
| ROLLUP-UI-035 | Radar topics, source signals, sweeps and digest detail | UI-035.1, UI-035.2 |
| ROLLUP-UI-036 | Decisions log, extraction and memory promotion | UI-036.1, UI-036.2 |
| ROLLUP-UI-037 | Agent Center, stop controls, automations and budget monitor | UI-037.1, UI-037.2 |
| ROLLUP-UI-038 | Focus timer, daily priorities, calendar and daily summary | UI-038.1, UI-038.2 |
| ROLLUP-UI-039 | Settings overview, navigator and registry coverage | UI-039.1, UI-039.2 |
| ROLLUP-UI-040 | Account profile, avatar, XP and balance settings | UI-040.1, UI-040.2 |
| ROLLUP-UI-041 | Accounts, service identity, cloud connection and logout | UI-041.1, UI-041.2 |
| ROLLUP-UI-042 | Privacy purpose controls, export and remote deletion | UI-042.1, UI-042.2 |
| ROLLUP-UI-043 | Runtime, toolchain, environment and secret references settings | UI-043.1, UI-043.2 |
| ROLLUP-UI-044 | Context documents, templates, preferences and memory entry points | UI-044.1, UI-044.2 |
| ROLLUP-UI-045 | Knowledge settings, engine connections, migration and note AI prompts | UI-045.1, UI-045.2 |
| ROLLUP-UI-046 | Marketplace catalog, packages, offline reports and update lifecycle | UI-046.1, UI-046.2 |
| ROLLUP-UI-047 | Extensions settings, catalogs, dev host and compatibility center | UI-047.1, UI-047.2 |
| ROLLUP-UI-048 | Foreign session import and automatic discovery settings | UI-048.1, UI-048.2 |
| ROLLUP-UI-049 | App environment, notifications, power, proxy and updates settings | UI-049.1, UI-049.2 |
| ROLLUP-UI-050 | AI connections, provider editor and workspace model overrides | UI-050.1, UI-050.2 |
| ROLLUP-UI-051 | Appearance, shell variants, theme, language, density and icon settings | UI-051.1, UI-051.2 |
| ROLLUP-UI-052 | Input, spellcheck, send key and voice settings | UI-052.1, UI-052.2 |
| ROLLUP-UI-053 | Workspace identity, TLS, enabled modes, directories and MCP settings | UI-053.1, UI-053.2 |
| ROLLUP-UI-054 | Permissions defaults, workspace rules, OpenClaw audit and command gateway | UI-054.1, UI-054.2 |
| ROLLUP-UI-055 | Labels, hierarchy, colors and saved collection views settings | UI-055.1, UI-055.2 |
| ROLLUP-UI-056 | Organizations, membership, invitations and team spaces settings | UI-056.1, UI-056.2 |
| ROLLUP-UI-057 | Messaging platform connections, pairing, bindings and access settings | UI-057.1, UI-057.2, UI-057.3, UI-057.4, UI-057.5, UI-057.6, UI-057.7 |
| ROLLUP-UI-058 | Server remote access, TLS, auth token and native sidecar settings | UI-058.1, UI-058.2 |
| ROLLUP-UI-059 | Cloud Runs provider, sandbox, quotas and scheduling settings | UI-059.1, UI-059.2 |
| ROLLUP-UI-060 | Security overview, OpenClaw lifecycle, vault health and risk acceptance | UI-060.1, UI-060.2, UI-060.3 |
| ROLLUP-UI-061 | Shortcuts page, command palette and platform key mappings | UI-061.1, UI-061.2 |
| ROLLUP-UI-062 | Preferences identity/persona/location and settings embedding | UI-062.1, UI-062.2 |
| ROLLUP-UI-063 | Shared Markdown, document, code, diff and media viewers | UI-063.1, UI-063.2 |
| ROLLUP-UI-064 | Shared menus, dialogs, accessibility and responsive primitives | UI-064.1, UI-064.2 |
| ROLLUP-UI-065 | Localization, dates, plural forms and visible product identity | UI-065.1, UI-065.2, UI-065.3 |
| ROLLUP-UI-066 | Browser profile import, cookies, bookmarks and credential consent | UI-066.1, UI-066.2 |
| ROLLUP-UI-067 | Workspace picker, creation, folder opening, remote TLS and SSH bootstrap | UI-067.1, UI-067.2 |
| ROLLUP-UI-068 | Unified Search across Notes, Sessions and Knowledge | UI-068.1, UI-068.2, UI-068.3 |
| ROLLUP-UI-069 | Project Roadmap one-surface workspace | UI-069.1, UI-069.2, UI-069.3, UI-069.4, UI-069.5 |
| ROLLUP-UI-070 | Project OKR cycles, objectives and key results | UI-070.1, UI-070.2, UI-070.3 |
| ROLLUP-UI-071 | Project AI drafting and repository context | UI-071.1, UI-071.2, UI-071.3, UI-071.4, UI-071.5 |
| ROLLUP-UI-072 | Shared Project authority, catalog and offline creation | UI-072.1, UI-072.2, UI-072.3, UI-072.4 |
| ROLLUP-UI-073 | Stable Note blocks, retained source and property dictionary | UI-073.1, UI-073.2, UI-073.3, UI-073.4, UI-073.5 |
| ROLLUP-UI-074 | Compact mini session window | UI-074.1, UI-074.2, UI-074.3 |
| ROLLUP-UI-075 | Unified Tables v2 shared product across 23 hosts | UI-075.1, UI-075.2, UI-075.3, UI-075.4, UI-075.5, UI-075.6, UI-075.7, UI-075.8, UI-075.9, UI-075.10, UI-075.11, UI-075.12, UI-075.13, UI-075.14, UI-075.15, UI-075.16, UI-075.17, UI-075.18, UI-075.19, UI-075.20, UI-075.21, UI-075.22, UI-075.23, UI-075.24, UI-075.25, UI-075.26, UI-075.27, UI-075.28, UI-075.29, UI-075.30, UI-075.31 |
| ROLLUP-UI-076 | License evidence in Server settings | UI-076.1, UI-076.2, UI-076.3 |
| ROLLUP-UI-077 | Drive library, authorized content index and import review | UI-077.1, UI-077.2, UI-077.3, UI-077.4 |
| ROLLUP-UI-078 | Messenger conversation shell and tools | UI-078.1, UI-078.2, UI-078.3 |
| ROLLUP-UI-079 | Meetings landing actions and history/detail presentation | UI-079.1, UI-079.2 |
| ROLLUP-UI-080 | Organization Admin Hub local scope and shared foundation | UI-080.1, UI-080.2, UI-080.3 |
| ROLLUP-UI-081 | Automation canvas node palette and inspector | UI-081.1, UI-081.2 |

## [PW-HARD-ORDER] Only unavoidable output dependencies

These are phase gates, not prerequisites to start whole tasks. Existing qualified producer outputs can satisfy a gate immediately; no artificial wait for the entire producer's DoD.

| Producer result | Dependent operation | Why sequence is unavoidable | Work continuing in parallel |
| --- | --- | --- | --- |
| Versioned payload/capability contract | Full cross-runtime serialization/permission proof | Both ends must interpret the same real message | Adapter/components/negative fixtures against the current contract |
| Trusted actor + current workspace grant | Protected real read/write/subscription | Authorization must precede that operation | Screen/state/race tests and unrelated domains |
| Reviewed schema/native-owner migration | First write into migrated persistent store | Ownership/schema must exist before writing | Migration fixtures, UI and other stores |
| Durable operation commit/ACK | Readback, replay and restart proof | A receipt cannot prove a nonexistent committed operation | Other leaf implementation and independent operations |
| Target native binaries/helper manifest | Installer/app assembly | Packaging consumes actual target bytes | Build scripts, installer UX, other target artifacts |
| Built artifact + authorized signing identity | Sign/notarize/staple/verify installation | Signature covers actual artifact bytes | Unsigned smoke tests, other targets, environment provisioning |
| Signed N and N+1 + update feed | Real upgrade/interruption/rollback proof | Two versions are inputs to an upgrade | Updater unit tests, feed scripts, other features |
| Qualified server/runtime + TLS/WSS + durable storage | Real hosted login/reconnect/upload/restart journeys | Browser operations require a reachable correctly configured server | Web components, adapters, local contract tests |
| Provider grant and permitted test account | Real external send/write/readback/revoke | Side-effect execution requires that grant/account | Synthetic negative tests and unrelated providers |
| Exact integrated source/lock/artifact bytes | Final SBOM/provenance/regression/signoff | Release evidence must describe the shipped revision | Continuous preliminary testing of each ready domain |

[Exact service edges](parallel-work/service-plan.json), [surface consumed outputs](parallel-work/surface-plan.json) and [platform phase edges](parallel-work/platform-plan.json) identify producer/consumer IDs. Reciprocal platform package references concern different phases (native staging versus installed verification); they are not cyclic whole-package waits. Final candidate binding is a release replay gate, not a development freeze.

## [PW-COORDINATION] Collisions are local coordination

- Root dependency/lock/CI owner promotes version updates and frozen-install results. Consumers implement in separate checkouts; no simultaneous writes to one checkout.
- Transport/auth owners approve additive DTO/capability changes. Domain owners write their handlers, tests and adapters independently.
- UI shell/routes and broad shared components use one file promotion owner, with parallel bounded patches and isolated tests. A shared path is not a reason to queue an entire module.
- Signing and GUI/media hardware are leased per run. Serialize only conflicting use of that resource; other environments/tests continue.
- Never discard cloud/Compound/September behavior by selecting an entire conflict side. Inspect both contracts and preserve stronger ownership, revision and request-scope checks.

## [PW-ACCEPTANCE] Handoff and closure requirements

Each leaf dispatch ends with its existing **Requirements / DoD / Full functional verification / Test method**, preserved verbatim in [launch-plan.json](parallel-work/launch-plan.json). The worker supplies source SHA and patch, frozen-lock/toolchain details, target/artifact hash, executed commands with exit codes, readback and negative/race/restart receipts, and explicit unavailable environment/provider outputs. Preliminary fixtures and source presence do not close full functional DoD. Parent owners additionally replay the parent breadth/combination workflow after all relevant child evidence exists.

**Launch-plan DoD:** all445 leaves assigned exactly once;180 parent rollups preserved; all three targets scheduled now; hard gates named by actual consumed output and phase; full acceptance and immutable code references retained; PR integration receipt distinguishes local lineage, remote merged states and unresolved verification.

**Launch-plan verification/test:** run `bun scripts/final-readiness-parallel-plan.ts` to validate the input hash and exact leaf partition, then `bun scripts/final-readiness-audit.ts --validate` to verify original625 task blocks and pinned code references. Recheck PR states/main SHA independently after publication.
