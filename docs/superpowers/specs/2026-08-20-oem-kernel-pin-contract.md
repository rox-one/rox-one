# OEM kernel pin contract (W2 fork)

- **Status:** binding contract for pin bump; no code in this Apache tree
- **Date:** 2026-08-20
- **Pin this document describes:** `3.1.28-rox.1`
- **Host repo:** `rox-one/rox-one` (Apache-2.0)
- **Fork repo:** private OEM kernel+UI (per license path **C**, UI strategy **W2**)
- **Parent design:** [2026-08-20-white-label-knowledge-engine-design.md](./2026-08-20-white-label-knowledge-engine-design.md) §5, §7.3, §8
- **Parent plan:** [../plans/2026-08-20-white-label-knowledge-engine.md](../plans/2026-08-20-white-label-knowledge-engine.md) Task 2 (argv), Task 11 (this file)
- **HTTP client:** `packages/core/src/knowledge/providers/siyuan/client.ts` (`SiyuanKernelClient`)
- **Pin record (host only):** `apps/electron/resources/oem-kernel-pin.json` — version, per-platform sha256, `relativePayloadDir`, `minApi`, `maxApiExclusive`. **Tarball/binary is not committed here.**

This file is the contract the OEM fork **must** satisfy before Rox bumps the pin. Host implementation does not vendor fork sources or unpacked UI assets.

## 1. Dual-repo rule

| Tree | May contain |
|---|---|
| `rox-one/rox-one` | Pin metadata, HTTP client, process manager, Craft chrome |
| OEM fork | Kernel + editor UI, ru locale, integrated mode, catalog URL |

Installer payload is a **pinned tarball + checksum**. Apache git history must not grow kernel sources.

Until `docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md` is `Status: ACCEPTED` with variant **C**, host `mode: managed` stays fail-closed. The fork may still build binaries for pin verification.

## 2. Pin identity `3.1.28-rox.1`

Host `OemKernelPin`:

| Field | Value for this pin |
|---|---|
| `version` | `3.1.28-rox.1` |
| `minApi` | `3.0.0` |
| `maxApiExclusive` | `4.0.0` |
| `relativePayloadDir` | `resources/oem-kernel` (or the value recorded in `oem-kernel-pin.json`) |
| `sha256` keys | `darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64` — each 64 hex chars of the **platform tarball** |

Pin bump = new `version` + new hashes + this contract re-verified. Workspace snapshot before bump; rollback binary on failed health (`POST /api/system/version`).

## 3. Integrated mode (`craftIntegrated=1`)

Editor URL loaded in Rox `WebContentsView` **must** honor query `craftIntegrated=1`.

When the flag is present, the fork **hides**:

1. App shell (window chrome, workspace switcher, global command palette that is not Protyle slash)
2. Documents / file tree sidebar (Rox owns navigator pixels)
3. Bazaar / marketplace UI
4. Kernel AI / chat / model settings
5. About, splash, and any branding surface

What remains: block editor canvas (slash, highlights, callouts, in-note databases), optional themed in-canvas breadcrumbs. No second Documents tree. No SiYuan date-tab strip. Plugin docks only via host `SurfaceDescriptor` / `syncBounds` if the host opens them — default off.

## 4. Locale and brand

- Default kernel locale: **`ru`** (`--lang=ru` and fork default).
- All user-visible fork strings localized. Host chrome stays 10-locale in `rox-one`.
- Product name **Rox**, surface **Знания**.
- Word **SiYuan** absent from UI, installer display name, and about. Logs/NOTICE may mention provenance if the OEM contract requires it.

## 5. Theme tokens

Unstyled upstream gray chrome is a defect. Map kernel CSS variables to Rox host tokens, including:

| Kernel variable | Host token | Notes |
|---|---|---|
| `--b3-theme-background` | `--background` | Editor canvas |
| surface / panels | `--muted` | Non-canvas fills |
| font size | ~13px | Match Craft navigator type (12–13px) |

Also map selection, radius, and fonts so the editor matches Craft/Rox chrome. Exact remaining `--b3-*` mappings live in the fork; they must not introduce a second visual system.

## 6. Plugin ABI and catalog (E1)

- Plugin ABI **unchanged**: `plugin.json`, docks, slash commands, kernel hooks.
- Public Bazaar URL **replaced** by OEM catalog from `rox.catalogUrl` (host/config; fork must not hardcode the public marketplace).
- Host allowlist (`OEM_PLUGIN_ALLOWLIST`) is empty until named packages are approved. Fork must not install packages outside that policy.
- Plugins that brand SiYuan fail catalog review.
- No second LLM runtime in the kernel.

## 7. HTTP API (`SiyuanKernelClient`)

Envelope: `{ code: 0, msg: '', data: T }`. `code != 0` is a kernel error.

Required compatibility for the pin window `[minApi, maxApiExclusive)` includes the client surface:

**Read / P1**

- `POST /api/system/version`
- `POST /api/system/currentTime`
- `POST /api/notebook/lsNotebooks`
- `POST /api/search/fullTextSearchBlock`
- `POST /api/query/sql` (`mode: 'readonly'`)
- `POST /api/block/getBlockInfo`
- `POST /api/block/getBlockKramdown`
- `POST /api/block/getChildBlocks`
- `POST /api/block/getDocInfo`
- `POST /api/block/checkBlockExist`
- `POST /api/attr/getBlockAttrs`
- `POST /api/ref/getBacklink` (`k`/`mk` mandatory strings)
- `POST /api/ref/getBackmentionDoc`
- `POST /api/filetree/getHPathByID`
- `POST /api/filetree/getPathByID`
- `POST /api/filetree/listDocsByPath` (doc tree including databases)
- `POST /api/export/exportMdContent`

**Soft bazaar/petal (catalog redirected)**

- `POST /api/bazaar/getInstalledPlugin`
- `POST /api/bazaar/getBazaarPlugin`
- `POST /api/bazaar/installBazaarPlugin`
- `POST /api/bazaar/uninstallBazaarPlugin`
- `POST /api/petal/loadPetals`
- `POST /api/petal/setPetalEnabled`

**P3 write whitelist only (agent still goes through host proposals)**

- `POST /api/filetree/createDocWithMd`
- `POST /api/block/appendBlock`
- `POST /api/block/updateBlock`

Human typing in Protyle writes the kernel live. Do not require Rox to open kernel SQLite.

Auth: `accessAuthCode` accepted as the existing kernel token. Tokens never in renderer; host stores via `CredentialManager`.

## 8. Launch flags (Task 2)

Managed spawn argv (verified at pin time):

```
<kernel> --workspace=<path> --port=<ephemeral> --accessAuthCode=<secret> --lang=ru
```

| Flag | Rule |
|---|---|
| `--workspace=` | Host path `join(configDir, 'knowledge-workspaces', connectionId)`. Do not silently mount a user SiYuan vault. |
| `--port=` | From host `allocatePort()`. **Must not be 6806** in managed mode. Loopback only. |
| `--accessAuthCode=` | Generated by host; kernel requires it on HTTP. |
| `--lang=ru` | Default UI language of the fork process. |

Health: `POST /api/system/version` within 5s. Shutdown: SIGTERM 10s then SIGKILL of the process tree. `WORKSPACE_LOCKED` if a second writer targets the same vault.

## 9. Artifact (not in this repo)

For each of `darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64`:

1. Build a tarball of the kernel payload that unpacks under `relativePayloadDir`.
2. SHA-256 the **tarball**; write hex into `oem-kernel-pin.json`.
3. Do **not** commit the tarball or unpacked binary to `rox-one/rox-one`.

Pin bump is blocked until §3–§8 are true for that artifact.

## 10. Acceptance checklist (fork + pin)

- [ ] `craftIntegrated=1` hides app shell, Documents, bazaar, AI, about
- [ ] Default locale `ru`; no SiYuan in product UI
- [ ] `--b3-theme-background` → `--background`; surface → `--muted`; font ~13px
- [ ] Plugin ABI unchanged; bazaar/catalog URL from `rox.catalogUrl`
- [ ] HTTP API compatible with `SiyuanKernelClient` for `[3.0.0, 4.0.0)`
- [ ] Launch flags `--workspace=`, `--port=`, `--accessAuthCode=`, `--lang=ru`; port ≠ 6806
- [ ] Four platform sha256 values recorded in host pin JSON; tarballs stored outside this git tree

## 11. Out of scope

- H3 in-process merge (`plans/next-program/decisions/002-h3-in-process-knowledge-kernel.md`)
- Shipping managed mode before G2 ACCEPTED/C
- Committing OEM sources into the Apache monorepo
