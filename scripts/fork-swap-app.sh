#!/usr/bin/env bash
# Fork-only: swap the freshly built Orca.app into /Applications.
# Portable — resolves the repo relative to this script, never a hardcoded path.
# Run it AFTER `pnpm run build:mac` (or the orca-fork-update skill's build step).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILT_APP="$REPO_ROOT/dist/mac-arm64/Orca.app"
INSTALLED_APP="/Applications/Orca.app"

# Fail loud before touching the installed app if the build is missing —
# otherwise we'd remove /Applications/Orca.app with nothing to replace it.
if [[ ! -d "$BUILT_APP" ]]; then
  echo "error: build not found at $BUILT_APP" >&2
  echo "       run 'pnpm run build:mac' first." >&2
  exit 1
fi

built_version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' \
  "$BUILT_APP/Contents/Info.plist" 2>/dev/null || echo '?')"
echo "→ swapping in Orca $built_version"

# Confirm the build carries the stable local signature; an ad-hoc build would
# make macOS re-prompt for every privacy permission (see FORK-NOTES.md).
# Capture first, then grep: `codesign … | grep -q` closes the pipe early, and
# under `set -o pipefail` codesign's SIGPIPE (141) would fake a signature miss.
codesign_info="$(codesign -dvvv "$BUILT_APP" 2>&1 || true)"
if ! grep -q 'Authority=Orca Fork Local Signing' <<<"$codesign_info"; then
  echo "warning: build is NOT signed with 'Orca Fork Local Signing'." >&2
  echo "         macOS may re-ask for permissions. Continue? [y/N]" >&2
  read -r reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "aborted."; exit 1; }
fi

osascript -e 'quit app "Orca"' 2>/dev/null || true
sleep 2

rm -rf "$INSTALLED_APP"
cp -R "$BUILT_APP" "$INSTALLED_APP"
xattr -dr com.apple.quarantine "$INSTALLED_APP" 2>/dev/null || true

open "$INSTALLED_APP"
echo "✓ Orca $built_version installed and launched."
