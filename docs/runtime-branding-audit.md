# Runtime branding and storage audit — 0.11.8

## Implemented in this change

- `context-docs/index.ts` resolves the same `resolveConfigDir()` as settings and sessions, lazily for each operation. `ROX_CONFIG_DIR` wins over the deprecated explicit alias. Project soul/rules overrides and non-overwriting template seeding remain intact.
- `config/env.ts` always selects `~/.rox` for the default. Before its first use it imports missing files from legacy singular/plural default trees. Explicit overrides never import global data.
- `config/legacy-config-migration.ts` performs copy-only import with no source deletion. Existing ROX files win. Conflicts are archived in `.legacy-imports/source-N/` outside active context, so conflicting instructions are never silently injected twice. A completion stamp prevents repeated imports. A failed import throws rather than pretending migration succeeded.
- Existing legacy variables remain accepted as explicit compatibility inputs and emit a deprecation warning. They should not be newly emitted by launch scripts.

## Initial inventory (before integration)

| Surface | Current finding | Required migration |
| --- | --- | --- |
| Package namespace | `@craft-agent/*` occurred across workspace manifests, imports, mocks, build aliases and workflows (over 1,200 tracked files) | Rename consistently to `@rox/*`, update Bun lock, frozen install and bundled build resolution together; no compatibility alias needed for unpublished internal modules |
| macOS/Windows identity | `electron-builder.yml` appId `com.lukilabs.craft-agent`; identity manifest deliberately retains this alias | Primary appId `one.rox.app`; verify macOS app data, Electron encryption keychain identity and Windows NSIS upgrade handling before removing old registration |
| Protocols | Identity accepts `rox` and legacy `craftagents`; `main/handlers/workspace.ts:115` still generates legacy URLs | Emit only `rox://`; retain parser alias for existing OAuth/links until their migration |
| Permissions path | `shared/src/agent/permissions-config.ts:51` reads old env/default directly | Use canonical resolver, preserving existing permissions via import |
| Config file detection | `agent/core/config-validator.ts`, `path-processor.ts` regex hardcode legacy hidden directory | Match canonical paths; retain compatibility only for deliberate legacy imports |
| Safe-mode file policy | `agent/mode-manager.ts:1735–1740` tests old workspace/root strings | Canonical configured root and workspace boundaries, including explicit custom config dirs; exercise protection tests |
| Logs | `electron/src/main/logger.ts:214` hardcodes updater log under legacy default | Canonical configured root, preserving old logs in migration |
| Remote runtime | SSH `server-bootstrap.ts` install/log/token paths and `ssh-tunnel-manager.ts` token fallback use legacy defaults | Use ROX primary remote root, read legacy token fallback only for already-installed remote servers; migrate actual host data before dropping alias |
| Default context/permission/theme docs | Bundled templates, generated guidance, UI localizations and config validator suggestions contain upstream product paths/names | Change ROX-owned instructional/user text; preserve upstream legal credits and source provenance |
| Launch/build tooling | `CRAFT_*`, old instance folder names, updater cache name and test isolation env occur across scripts/main | Emit ROX names; retain alias reads only at compatibility boundaries; regenerate lock and verify packaged app-update.yml/cache naming |
| Legacy boot helper | `main/brand-config-boot.ts` calls identity `runBrandConfigMigration()`; it force-copies only when no ROX destination exists, but returns legacy when both exist | Boot may call resolver instead; canonical new resolver imports safely in either case. Existing helper/export/rollback APIs need audit to avoid contradictory UI results |
| Rollback helper | `identity/config-migration.ts` rollback recursively deletes destination once its old stamp exists | Do not invoke after ROX has received new user changes; replace with non-destructive export/recovery flow or require exact snapshot ownership proof |
| Historical docs/licenses | Numerous old source paths, upstream issue URLs, attribution and third-party skill metadata | Keep actual upstream identity and historical evidence; no misleading replacement of author/source/license names |

## Verification scope

Regression coverage includes canonical import, unchanged source, ROX conflict precedence plus archive, plural legacy import, one-time behavior, override isolation, ROX-only context loading, alias precedence, seeding, CRUD, sanitization, project override, and actual system prompt integration. Tests operate in temporary directories; user documents and credentials are never read into test output.

The migration intentionally does not continue importing edits made later in legacy trees. New runtime edits belong in the canonical selected ROX root. Preserved sources and conflict archives remain available for explicit recovery.

## Follow-up closure

- Permissions directory and updater log now use the canonical resolver.
- Main boot uses the resolver directly instead of the contradictory old migration helper.
- Config validation/path classification covers `~/.rox`, the explicit configured root, and legacy compatibility paths; configured-root sibling prefixes do not match.
- Safe-mode error guidance derives the workspace root from the supplied plans directory and uses the selected config root. Actual authorization containment/realpath logic was already independent of branding and remains unchanged.
- Newly generated workspace-session links use `rox://`; deep-link documentation now describes the primary scheme. Existing legacy links continue to parse.

## Credentials and application identity

`credentials/backends/secure-storage.ts` uses a fixed OS keychain service `craft-agent.credentials`, account `master`, and an encrypted file header `CRAFT01\\0`. A raw string replacement can strand existing credentials: installations with only the keychain copy would generate a different master key after a service rename. Keep the legacy read service as a compatibility boundary, prefer a ROX primary service for new writes, and copy the same validated existing key to the ROX entry while preserving the legacy entry. Verify decryption before committing any change. Do not rewrite the encrypted file header without a dual-format decoder and authenticated migration.

Electron `app.setName()` already defaults to Rox, so default `userData` uses the Rox product directory. Numbered development instances still have a legacy hardcoded userData override in `main/index.ts`; migrate that separately without dropping cookies, browser state or local storage. Changing the appId can affect macOS Keychain access ACLs, OS permission records and Windows NSIS uninstall/upgrade registration. The shared credential backend itself uses the explicit service above, rather than deriving it from appId. Preserve its access and verify master-key recovery before replacing app identifiers. No live keychain values were queried or printed during this audit.

Credential service migration is now implemented: the canonical service is `rox.credentials`; read fallback validates the legacy master key and copies exactly that key to the new entry without deleting its source. If the new write is denied, the preserved legacy key still works. Existing encrypted file headers and store bytes are unchanged. Four mocked keychain regressions cover precedence, identical-key copying, denied-write fallback and invalid-key rejection without touching host secrets.

## Managed acpx CLI

- Upstream: https://github.com/openclaw/acpx, MIT, version 0.19.4 (matching bundled upstream skill).
- npm tarball: `https://registry.npmjs.org/acpx/-/acpx-0.19.4.tgz`, 658040 bytes, SHA256 `ccb1e4ad1cb1468493769af3a2ba0df6aeffb4e1e176541f1f231f3ec5782311`; bytes also verified against registry SHA512 integrity before embedding metadata.
- Exact production dependency lock: 73 entries, HTTPS npm registry URLs and SHA512 integrity for every transitive package; installation uses npm ci with lifecycle scripts disabled. The package is default-on in managed toolchain for all four supported platforms and depends on managed Node (upstream Node >=22.13 requirement).
- POSIX and Windows launchers use the managed Node runtime, with optional ROX_NODE_PATH override. Tests execute a declared CLI through the launcher and verify Node rather than Bun.
- Upstream ACP agent adapters and authentication are independent first-use requirements. Installing acpx does not replace the OMP runtime used for ROX conversations and does not claim those external agents are preinstalled or authenticated.

## Integrated application identity and namespace

- Workspace manifests/imports/build aliases now use `@rox/*`; the pinned Bun lock is regenerated.
- Packaged appId matches canonical `one.rox.app`. Explicit NSIS GUID `61dc82ee-e3b9-557b-98c4-20b9178a0f78` preserves the prior Windows installation registration.
- Original copyright, licenses, source provenance, legacy OAuth client identifiers and migration-format strings remain intact. These are compatibility/attribution boundaries, rather than newly emitted product branding.
- GitHub release installer now verifies published asset digest/size and preserves the old app bundle and user data.
