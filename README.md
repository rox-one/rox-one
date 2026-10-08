# ROX

ROX is a desktop workspace for agent sessions, connected sources, documents, skills and automations. The execution engine for sessions, tasks and auxiliary agent calls is **OMP** (oh-my-pi).

## Install

Download installers from [ROX GitHub Releases](https://github.com/rox-one/rox-one/releases):

| Platform | Artifact |
| --- | --- |
| macOS Apple Silicon | `Rox-arm64.dmg` or `Rox-arm64.zip` |
| Windows x64 | `Rox-x64.exe` |

The release manifest records artifact checksums, source commit and signing status. Current release automation targets these two platforms; Intel macOS and Linux desktop installers are not part of this release matrix.

Auto-update metadata is published with GitHub releases. Unsigned macOS builds can check for updates, but automatic installation is suppressed until a properly signed release is available.

## Agent runtime

- All session and task execution goes through OMP. Legacy backend selections migrate to a configured OMP connection.
- Each chat and auxiliary request automatically activates `orchestrate workflowz ultrathink` with maximum thinking.
- Native transcripts are resumed before a new prompt is sent after process restart.
- Branches fork at the selected answer in a private copy of the parent transcript. Parent history is preserved.
- Older sessions without native transcripts can reconstruct their stored ROX history. Missing provider metadata is explicitly marked as unavailable; malformed transcripts fail instead of silently dropping records.
- A persistent reset marker prevents cleared or undone messages from reappearing after restart.

Implementation and wire contracts: [OMP RPC notes](docs/omp-rpc-notes.md), [runtime specification](docs/runtime-0.11.8-spec.md), [native fork/resume evidence](docs/evidence/omp-native-history-0.11.8.json).

## Skills

The offline catalog contains **330 skills in 34 packs**. It includes Superpowers, Impeccable, Obsidian, Matt Pocock, Vercel, Compound Engineering, gstack, gbrain, Telegram, Jev, Exa, acpx, oh-my-agent and the other requested skill integrations.

- [Requested skill mapping](apps/electron/resources/skills/REQUESTED-SKILLS.json): upstream sources, alternatives, licenses and prerequisites.
- [Pinned pack manifest](apps/electron/resources/skills/SKILLS.lock).
- [Native OMP discovery evidence](apps/electron/resources/skills/OMP-DISCOVERY.json).

Figma and Groma integrations use explicitly identified ROX adapters. DOCX/XLSX/PPTX use a licensed document implementation rather than copying restricted upstream packages. A discoverable skill does not by itself configure an external service, credential, browser or application.

Managed acpx CLI is pinned to **0.19.4**, with verified package integrity and production dependency locks.

## Configuration and context

The canonical configuration directory is `~/rox`. Set `ROX_CONFIG_DIR` to use an isolated profile.

```text
~/rox/
  config.json
  credentials.enc
  preferences.json
  context/
  workspaces/
    <workspace>/
      config.json
      sources/
      skills/
      sessions/
        <session>/omp/
```

Legacy configuration is imported by copying; original files are preserved. Deprecated identifiers remain only where compatibility and source attribution require them. New links use `rox://`.

Each OMP process receives the ROX system context, session tools and connected source tools. The private runtime profile provides the pinned skill tier and mandatory execution policy. Working-directory instruction files and workspace context are handled by the existing context pipeline.

## Development

Use the pinned **Bun 1.3.14** toolchain.

```bash
git clone https://github.com/rox-one/rox-one.git
cd rox-one
bun install --frozen-lockfile
bun run electron:dev
```

```bash
bun run typecheck:all
bun run validate:ci
bun run electron:build
```

Packages use the `@rox/*` workspace namespace. Test preloads isolate configuration from the user's live profile. See [AGENTS.md](AGENTS.md) for repository conventions and [the Russian documentation hub](docs/ru/RX-DOC-0024-hub.md) for operational guides.

Desktop builds and checksum verification are defined in [Desktop Release Build](.github/workflows/desktop-release.yml). Publication uses [Publish Desktop Release](.github/workflows/publish-desktop-release.yml).

## Sources and license

ROX is derived from [the original upstream repository](https://github.com/craft-ai-agents/craft-agents-oss). Original copyright notices, licenses and third-party attribution are retained in [LICENSE](LICENSE), [NOTICE](NOTICE) and [third-party notices](notices/THIRD-PARTY-NOTICES.txt). Bundled skill packs carry their own source and license records.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
