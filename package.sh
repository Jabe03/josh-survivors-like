#!/usr/bin/env bash
# Builds the game and writes the two submission files to dist/:
#   dist/website.tar.gz  the site, with index.html at the archive root
#   dist/install.sh      extracts the archive into a given folder
set -euo pipefail
cd "$(dirname "$0")"

# Clean build, so stale compiled files from deleted sources don't ship.
rm -rf out dist
npm ci
npm run build

mkdir -p dist
tar -czf dist/website.tar.gz --owner=0 --group=0 --mode='u=rwX,go=rX' index.html style.css out
cp install.sh dist/install.sh
chmod +x dist/install.sh

echo "Submission files ready:"
ls -l dist
