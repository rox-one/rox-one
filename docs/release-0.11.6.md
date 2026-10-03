# Rox 0.11.6 desktop release integration

Prepared 2026-10-03 from main `f63294ba4fffa7238b46b24e918925a313ad0b12` in an isolated worktree. Existing user changes in the original checkout were preserved.

## Integrated pull requests

The merge graph preserves the exact submitted heads of PRs #1082, #1087, #1230, #1292, #1293, #1294, #1313, #1314, #1315, #1316, #1317, #1318, #1319, #1320, #1321, #1322, #1323, #1377 and #1384. Older overlapping implementation was reconciled with the newer assembled R15 workspace boundaries, canonical roadmap revisions, permission fences and agent budget accounting. Conflicting historical plans are retained in `docs/release-pr*-{spec,plan}.md`.

Merged delivery does not assert completion of the broader issues mentioned in historical draft PR descriptions. Live provider completions, native migration activation, and production gateway deployments retain their existing acceptance boundaries.

## Desktop artifacts

- macOS Apple Silicon: `Rox-arm64.dmg`, `Rox-arm64.zip`.
- Windows x64: `Rox-x64.exe` (NSIS per-user installer).
- Intel macOS is currently unsupported by the pinned `@tursodatabase/database@0.7.2`, whose published optional dependencies do not include a Darwin x64 native binary.
- This release pipeline does not have signing/notarization credentials. Artifacts are unsigned and must be identified accordingly in the release notes.
- The upstream Craft auto-update endpoint is unchanged; publishing Rox installers to GitHub does not update that endpoint.

## Build and verification

The native runner uses `bun scripts/desktop-release.ts`, canonical `electron:build`, SDK/ripgrep staging, checksum-verified bundled Bun and uv downloads, Pi/cloud subprocess staging and electron-builder with `--publish never`. Native SQLite staging follows the actual build target, including Windows `-msvc`.

The package gate checks application files, invokes packaged SDK/Bun/uv binaries, parses the CJS main bundle, opens an in-memory native SQLite database and records version, source commit, size and SHA256 for each installer in `manifest-<platform>-<arch>.json`. CI artifacts are uploaded only after that gate succeeds.

GitHub Actions: `.github/workflows/desktop-release.yml` runs validation and both native builds. CircleCI: `.circleci/desktop.yml` is a dedicated pipeline definition, with no gateway deployment workflow. The supplied account token authenticated successfully; a new `rox-one` project was created in organization `tttxxx`, but the GitHub App pipeline-definition API returned HTTP 400. CircleCI builds require the repository connection to be completed; the configured pipeline has not been claimed as executed.
