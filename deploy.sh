#!/usr/bin/env bash
# Deploys to my own server through the same install path the grader will use.
set -euo pipefail
cd "$(dirname "$0")"
./package.sh
./dist/install.sh /var/www/html/final
