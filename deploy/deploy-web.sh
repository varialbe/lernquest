#!/usr/bin/env bash
# Baut die Web-App und spielt sie nach /var/www/lernquest aus (atomar per rsync --delete-after).
set -euo pipefail
cd "$(dirname "$0")/../apps/web"
nice -n 10 npx vite build
rsync -a --delete-after dist/ /var/www/lernquest/
echo "Web-App deployt: $(ls dist/assets | wc -l) Dateien"
