#!/bin/bash
# Installs Circle Survivors into the given folder.
# Usage: ./install.sh folderName
# The game is a static site (HTML, CSS, JavaScript). It needs no database, server-side
# software or server configuration, so it cannot affect other sites on the server.
set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Usage: ./install.sh folderName"
    exit 1
fi

DEST="$1"
# Look for the archive next to this script, so it works from any current directory.
ARCHIVE="$(cd "$(dirname "$0")" && pwd)/website.tar.gz"

if ! command -v tar >/dev/null 2>&1; then
    echo "Error: tar is required but not installed."
    exit 1
fi

if [ ! -f "$ARCHIVE" ]; then
    echo "Error: $ARCHIVE not found. Keep website.tar.gz in the same folder as install.sh."
    exit 1
fi

mkdir -p "$DEST"
tar -xzf "$ARCHIVE" -C "$DEST" --no-same-owner

# Make sure the web server can read everything that was installed.
chmod -R a+rX "$DEST/index.html" "$DEST/style.css" "$DEST/out"

echo "Circle Survivors successfully installed in: $DEST"
