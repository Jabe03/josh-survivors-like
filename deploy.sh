#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm ci && npm run build
rsync -a --delete index.html style.css out /var/www/html/final/