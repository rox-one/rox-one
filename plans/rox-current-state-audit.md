# Rox current-state audit — reconciliation index

- **Date:** 2026-08-12 · **Repo:** `rox-one/rox-one` @ `main` `5797f431`
- **Purpose:** reconcile the program brief with evidence, classify donors, and
  point to the existing surface inventory rather than duplicating it.

## The 60-surface truth inventory already exists — do not rebuild it

The Section-5 "Rox Truth Inventory" is **already implemented** as
`plans/integration-audit.md`, added by **`rox-one/rox-one` PR #2**
(branch `cursor/integration-audit-7c33`). It is a live-verified audit
(install/build/boot/HTTP/browser/tests/OMP-RPC probes) covering OMP, agent
runtime, Knowledge/SiYuan, Sources/MCP, secrets/toolchain/marketplace, session
collections, remote/cloud (server/webui/CLI/viewer/gateways/iOS), artifacts, and
white-label — with `NOT_STARTED/STUB/PARTIAL/FUNCTIONAL/VERIFIED` statuses and
per-surface files/APIs/persistence/auth/tests/gaps.

**This program adopts that inventory as the source of truth for surfaces.** This
file adds only what the inventory does not: (a) canonical-repo/target-stack
reconciliation, and (b) the donor classification the brief (Section 0) requires.
Branch-level archaeology is in `plans/repository-archaeology.md`; the domain
decomposition is in `plans/session-domain-convergence.md`.

## Target-stack reconciliation (brief Sections 3, 6, 7)

The brief's "expected conceptual stack" (Bun · Turbo · Docker · Postgres ·
Electric · API · Web · Caddy) and its "control plane / sandbox broker / queue /
runtime gateway / policy gateway" diagram describe a system that is **only
partially present** in the accessible repo. Evidence:

| Brief component | Reality in `rox-one/rox-one` | Status |
|---|---|---|
| Bun | Yes (pinned 1.3.14) | `VERIFIED` |
| Turbo monorepo | **Absent** (no `turbo.json`; only `.turbo` gitignore + a tool-icon entry) | `SOURCE_GAP` |
| Docker / Compose | Only `Dockerfile.server` (single headless server image); no compose stack | `PARTIAL` |
| Postgres / Electric | **Absent** (0 refs); state is `~/.craft-agent/` JSON/JSONL + SQLite FTS | `SOURCE_GAP` |
| Caddy / proxy | **Absent** (one README line naming "nginx, Caddy" as generic advice) | `SOURCE_GAP` |
| Huly / Mastra | **Absent** (0 refs anywhere) | `SOURCE_GAP` |
| API / Web | Yes — WS-RPC headless server (`packages/server`) + web UI (`apps/webui`) | `VERIFIED` |
| Browser automation | Yes — `agent-browser` VPS browser panes | `FUNCTIONAL` |

**Conclusion:** the accessible product is the **craft-agents Bun/Electron/
headless-server agent app**, not a Huly-based Electric/Postgres/Turbo product. The
brief's control-plane vocabulary maps onto *existing* Rox subsystems rather than a
missing stack:

- **Queue / Runtime Gateway / Sandbox Broker** ≈ `packages/cloud-runner`
  (provider contract + `LocalSubprocessProvider` / `CloudflareComputerProvider` /
  `ModalProvider`), `apps/cloud-gateway`, `apps/modal-gateway`, and
  `SessionManager` turn orchestration (audit §3.7.5–3.7.7).
- **Policy Gateway (approvals/scopes)** ≈ permission modes + `PermissionManager` +
  layered `permissions.json` + host-tool approval proxying (audit §3.2, §3.1).
- **Sandbox / worktree / self-hosted** ≈ SSH remote workdirs, `agent-browser`
  panes, and the (nascent) worktree references — but there is **no first-class
  `SandboxLease`** (see `plans/session-domain-convergence.md`).

Before any control-plane build-out, confirm the SOURCE_GAPs in
`plans/repository-archaeology.md` §6 (does `agisota/rox-one` / a Huly product
exist elsewhere?). Otherwise this program targets the real stack.

## Donor classification (brief Section 0)

Preference order applied: existing Rox primitive → API/protocol → MCP/CLI adapter
→ native reimplementation → microfrontend/embed → selective port → vendoring
(exception). **Licenses are UNVERIFIED** — `gh` auto-detection was inconclusive
(NO-LICENSE) for every donor, which is a detection limitation, not proof of an
absent license. **No code may be copied before a per-repo license + architecture
review.**

| Donor | Accessible? | Overlaps Rox subsystem | Classification | Rationale / preferred path |
|---|---|---|---|---|
| `Infisical/infisical` | Yes | Secrets (`credentials/`; Infisical is opt-in CLI only, audit §3.5) | **MCP/API INTEGRATION** (vendoring = REJECT) | Rox already has `credentials.enc`; integrate Infisical as an external secrets *source*, not a vendored platform |
| `Infisical/infisical-mcp-server` | Yes | Sources/MCP | **MCP/API INTEGRATION** | The concrete integration path for Infisical-backed secrets |
| `Infisical/cli` | Yes | Toolchain (already pinned opt-in) | **ADAPTER** | Already in the toolchain manifest; wrap as a CLI adapter if secrets sync is pursued |
| `cathrynlavery/diagram-design` | Yes | Artifacts / HTML-preview (audit §3.8) | **DESIGN REFERENCE** (or ADOPT as a skill pack, license permitting) | Self-contained HTML+SVG diagram templates fit the existing sandboxed HTML-preview block |
| `bitwarden/clients` | Yes | Secrets/credentials UX | **BEHAVIOR REFERENCE** (vendoring = REJECT) | Large multi-app client; reference secret-UX patterns only |
| `giuliastro/harness-remote` | Yes | Remote control / iOS (audit §3.7.10) | **BEHAVIOR REFERENCE** | Phone/desktop harness control (OMP/PI/Claude) informs Rox remote-control UX |
| `ifiokjr/monopi` | Yes | Toolchain / marketplace / skills (audit §3.5) | **BEHAVIOR REFERENCE** / NOT RELEVANT | Rox already has one-click toolchain + signed marketplace |
| `makoMakoGo/fish-claude` | Yes | — (personal dotfiles) | **NOT RELEVANT** | Shell config for claude/codex/omp |
| `AVIDS2/memorix` | Yes | Memory (`shared/src/memory/`) | **BEHAVIOR REFERENCE** (MCP integration optional) | Rox has native memory; adopt patterns or interop via MCP, don't replace |
| `agisota/ai2040-ru` | **NO (404)** | — | **SOURCE_GAP / NOT RELEVANT** | Inaccessible |
| `josephsteuerjr/praxis-open-source` | Yes | Agent runtime / tools / memory | **BEHAVIOR REFERENCE** | Inspectable self-hosted agent patterns; Rox runtime already exists |
| `block/buzz` | Yes | Collaboration/channels (surface #40, NOT_STARTED) | **BEHAVIOR REFERENCE** (embed candidate) | "Hive mind" collaboration — design a Rox-native surface; vendoring rejected |
| `nexu-io/open-design` | Yes | Design/canvas (surface #34/35, NOT_STARTED, audit §3.8) | **DESIGN REFERENCE** / MICROFRONTEND-EMBED candidate | Local-first agent-design app; strongest fit for the missing design surface |
| `eloklam/siyuan-agent` | Yes | Knowledge/SiYuan (audit §3.3) | **BEHAVIOR REFERENCE** | Rox already has deep SiYuan integration; reference agent patterns only |
| `agisota/craft-agents-oss` | Yes | Same code line | **ADAPTER / legacy mirror** | Same `main` commit; triage residual branches then archive (see archaeology §3) |

No donor is currently a **VENDOR** or **NATIVE PORT** recommendation — every
overlapping capability either already exists in Rox (prefer the primitive) or is
better reached via MCP/API/adapter or a native surface. Re-evaluate per feature
once a specific P0 work package targets it, and always after a license review.

## Recommended P0 sequence (small, independently mergeable)

1. **Cloud Agent env (this PR):** `.cursor/environment.json` +
   `docs/cloud-agents/environment.md` — makes the repo reproducibly bootable
   headless (verified). Unblocks every subsequent Cloud Agent work package.
2. **Land PR #2** (`plans/integration-audit.md`) as the surface source of truth.
3. **Branch hygiene:** prune the ~80 merged `feature/pr-*` tips; triage the
   residual `feat/knowledge-*` / `feat/shell-*` / `feat/p4-siyuan-surfaces`
   (archaeology §2). Cherry-pick-verify `fix/sandbox-env-strip` +
   `fix/test-pollution-fetches`.
4. **OMP fresh-install hang** (audit §3.1) — highest-severity functional bug;
   isolated fix + unit tests.
5. **Viewer share-API auth** (audit §3.7.4) — security gap (unauthenticated
   POST/PUT/DELETE), website-side but tracked here.
6. **Session domain convergence** — staged per `plans/session-domain-convergence.md`
   (compatibility layer first; no big-bang migration).

Each is a separate PR with its own verification; this PR delivers only #1 plus
the planning docs.
