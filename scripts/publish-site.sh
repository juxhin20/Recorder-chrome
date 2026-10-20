#!/bin/bash
# Builds the extension zip from the committed code and uploads the landing page
# to https://appalbania.com/recorder/ (SSH alias `appalbania`).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
ZIP="site/Recorder-Chrome-AppAlbania-$VERSION.zip"
git archive --format=zip --prefix=Recorder-Chrome-AppAlbania/ -o "$ZIP" HEAD
grep -q "AppAlbania-$VERSION.zip" site/download/index.php || { echo "Update site/download/index.php to $VERSION first"; exit 1; }
REMOTE=appalbania:appalbania.com/app/public/recorder/
# no --delete: older versioned zips stay downloadable
rsync -av --exclude '.*' site/ "$REMOTE"
echo "✓ https://appalbania.com/recorder/  ($ZIP)"
