#!/bin/bash
# Install the most recently published ROX desktop release (including previews).
# Usage: install-app.sh [--metadata-only]
set -euo pipefail

fail() { printf 'ROX: %s\n' "$*" >&2; exit 1; }
metadata_only=false
case "${1:-}" in
  --metadata-only|--dry-run) metadata_only=true ;;
  --help|-h) printf 'Usage: %s [--metadata-only]\nInstalls the latest published macOS arm64 ROX release, including prereleases.\n' "$0"; exit 0 ;;
  '') ;;
  *) fail "Unknown argument: $1" ;;
esac
[ "$#" -le 1 ] || fail 'Only one optional argument is supported.'

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) ;;
  Darwin/x86_64) fail 'Intel macOS installers are not published: the current native database dependency supports macOS arm64 only.' ;;
  Linux/*) fail 'Linux desktop installers are not published in the current ROX release.' ;;
  *) fail 'This installer supports macOS arm64. Windows users should download Rox-x64.exe from https://github.com/rox-one/rox-one/releases.' ;;
esac
for command in curl osascript shasum plutil ditto; do
  command -v "$command" >/dev/null 2>&1 || fail "Required macOS command is missing: $command"
done

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/rox-install.XXXXXX")"
staged_app=''
cleanup() {
  # These paths are created exclusively by this invocation; app data is untouched.
  [ -z "$staged_app" ] || [ ! -d "$staged_app" ] || rm -rf "$staged_app"
  rm -rf "$work_dir"
}
trap cleanup EXIT

printf 'Reading published releases from rox-one/rox-one…\n'
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/rox-one/rox-one/releases?per_page=100' \
  -o "$work_dir/releases.json"

# JavaScript for Automation ships with macOS, so a fresh Mac needs no Node/jq.
cat > "$work_dir/select-release.js" <<'JXA'
ObjC.import('Foundation');
function run(argv) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);
  const releases = JSON.parse(ObjC.unwrap(text));
  if (!Array.isArray(releases)) throw new Error('GitHub did not return a release list');
  const published = releases.filter(r => !r.draft && r.published_at)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const release = published[0];
  if (!release) throw new Error('No published ROX release is available');
  if (!/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(release.tag_name)) throw new Error('Unsupported release tag');
  const asset = (release.assets || []).find(a => a.name === 'Rox-arm64.zip' && a.state === 'uploaded');
  if (!asset) throw new Error('Latest published release has no macOS arm64 ZIP');
  if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('Installer has no verified GitHub SHA256 digest');
  const expected = 'https://github.com/rox-one/rox-one/releases/download/' + release.tag_name + '/Rox-arm64.zip';
  if (asset.browser_download_url !== expected) throw new Error('Unexpected installer URL');
  if (!(Number.isSafeInteger(asset.size) && asset.size > 0)) throw new Error('Invalid installer size');
  return [release.tag_name, asset.browser_download_url, asset.digest.slice(7), String(asset.size),
    'https://github.com/rox-one/rox-one/releases/tag/' + release.tag_name].join('\n');
}
JXA
metadata="$(osascript -l JavaScript "$work_dir/select-release.js" "$work_dir/releases.json")"
fields=()
while IFS= read -r field; do fields+=("$field"); done <<< "$metadata"
[ "${#fields[@]}" -eq 5 ] || fail 'Release metadata is incomplete.'
version="${fields[0]}"
installer_url="${fields[1]}"
expected_sha256="${fields[2]}"
expected_size="${fields[3]}"
printf 'Release: %s\nAsset: %s\nSHA256: %s\nBytes: %s\n' "$version" "$installer_url" "$expected_sha256" "$expected_size"
if [ "$metadata_only" = true ]; then exit 0; fi

config_dir="${ROX_CONFIG_DIR:-$HOME/.rox}"
download_dir="$config_dir/downloads"
mkdir -p "$download_dir"
archive="$download_dir/Rox-${version#v}-arm64.zip"
partial="$work_dir/Rox-arm64.zip"
printf 'Downloading ROX %s…\n' "$version"
curl --fail --show-error --location --proto '=https' --tlsv1.2 --progress-bar \
  "$installer_url" -o "$partial"
actual_size="$(stat -f '%z' "$partial")"
actual_sha256="$(shasum -a 256 "$partial" | awk '{print $1}')"
[ "$actual_size" = "$expected_size" ] || fail 'Downloaded installer size differs from GitHub metadata.'
[ "$actual_sha256" = "$expected_sha256" ] || fail 'Downloaded installer SHA256 differs from GitHub metadata.'
mv "$partial" "$archive"

ditto -x -k "$archive" "$work_dir/unpacked"
app="$work_dir/unpacked/Rox.app"
[ -d "$app" ] || fail 'Verified archive does not contain Rox.app.'
app_version="$(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist")"
[ "$app_version" = "${version#v}" ] || fail 'Application version does not match its release tag.'
[ -x "$app/Contents/MacOS/Rox" ] || fail 'Application executable is missing.'

install_dir='/Applications'
if [ ! -w "$install_dir" ]; then install_dir="$HOME/Applications"; fi
mkdir -p "$install_dir"
destination="$install_dir/Rox.app"
staged_app="$install_dir/.Rox-install-$$.app"
[ ! -e "$staged_app" ] || fail 'An installation staging path already exists.'
ditto "$app" "$staged_app"

# Quit only an installed ROX process. Never stop development Electron sessions.
if pgrep -f "$destination/Contents/MacOS/Rox" >/dev/null 2>&1; then
  osascript -e 'tell application "Rox" to quit' || fail 'Close ROX before replacing its application bundle.'
  for attempt in 1 2 3 4 5; do
    pgrep -f "$destination/Contents/MacOS/Rox" >/dev/null 2>&1 || break
    sleep 1
  done
  if pgrep -f "$destination/Contents/MacOS/Rox" >/dev/null 2>&1; then fail 'ROX is still running; close it and retry.'; fi
fi
backup=''
if [ -e "$destination" ]; then
  backup_dir="$config_dir/backups/apps"
  mkdir -p "$backup_dir"
  backup="$backup_dir/Rox-before-${version#v}-$(date +%Y%m%d-%H%M%S)-$$.app"
  mv "$destination" "$backup"
fi
if ! mv "$staged_app" "$destination"; then
  [ -z "$backup" ] || mv "$backup" "$destination"
  fail 'Could not activate the installed application; previous bundle restored.'
fi
staged_app=''
printf 'Installed %s at %s.\nUser data and credentials were preserved.\n' "$version" "$destination"
[ -z "$backup" ] || printf 'Previous application backup: %s\n' "$backup"
open "$destination"
