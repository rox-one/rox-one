# ROX desktop updates

Starting with 0.11.7, packaged ROX uses the public GitHub provider for
`rox-one/rox-one`. Preview releases are accepted (`allowPrerelease=true`),
downgrades are disabled. The app checks at launch, downloads updates in the
background, and installs a downloaded update when quitting or selecting Restart.
Existing dismissal, session persistence and stale-cache safeguards remain enabled.

## Release procedure

1. Bump all product packages and regenerate bun.lock using Bun 1.3.14.
2. Push a `release/desktop-*` branch to run Desktop Release Build.
3. After successful validation, merge the exact source into main.
4. Create a draft release targeting the exact build commit.
5. Dispatch Publish Desktop Release with the successful run ID and tag.

The build verifies the embedded app-update.yml points at this repository.
Publication requires latest.yml (Windows) and latest-mac.yml (macOS), verifies
their version, installer set, sizes and SHA512 hashes, and uploads all assets
before publishing the draft. No incomplete release is exposed to the updater.

## macOS signing prerequisite

Squirrel.Mac requires a signed app with a consistent identity. Unsigned/ad-hoc
builds intentionally suppress updater checks; publishing a manifest does not
remove this restriction. Development builds and copies under ~/Applications
also suppress checks. Install a signed release under /Applications for the
production update channel.

Configure GitHub Actions secrets MAC_CSC_LINK (base64 P12 certificate) and
MAC_CSC_KEY_PASSWORD. For notarization configure APPLE_ID,
APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID. Windows optionally uses
WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD. Never commit certificates or passwords.
Without these secrets, the pipeline continues to publish unsigned previews;
Windows NSIS update installation is available, macOS installation requires the
signing prerequisite to be completed.

## Migration from 0.11.6 and earlier

Those installed builds contain the old Craft feed. Install 0.11.7 once manually
from this repository's release assets to receive the new provider configuration.
On macOS use a future Developer ID signed release to enable automatic installation.
For troubleshooting an existing build, CRAFT_UPDATER_URL=github://rox-one/rox-one
can override the feed; it does not bypass signing or development safeguards.

The public update manifests authenticate downloads by SHA512. Artifact integrity
and feed resolution are verified by CI; unsigned preview publication is not proof
of successful macOS installation or Gatekeeper notarization.
