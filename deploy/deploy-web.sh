#!/usr/bin/env bash
# Baut die Web-App und spielt sie nach /var/www/lernquest aus (atomar per rsync --delete-after).
# Zusätzlich: Live-Update-Paket für die iOS-App (absolute API-Adresse) unter /app-updates/ + Manifest.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"

# Version = Commit; bei uncommitteten Änderungen zusätzlich ein Zeitstempel (sonst sähe die App kein Update)
VERSION="$(git rev-parse --short=10 HEAD)"
git diff --quiet HEAD -- . ../../packages || VERSION="${VERSION}-$(date -u +%Y%m%d%H%M%S)"
export VITE_APP_VERSION="$VERSION"

nice -n 10 npx vite build
# App-Paket: gleicher Code, API absolut (die App läuft unter capacitor://localhost)
VITE_API_BASE="${LERNQUEST_PUBLIC_URL:-https://lern.varialbe.xyz}" nice -n 10 npx vite build --outDir dist-native --emptyOutDir >/dev/null
mkdir -p dist/app-updates
ZIP="bundle-${VERSION}.zip"
(cd dist-native && rm -rf app-updates && zip -qr "../dist/app-updates/${ZIP}" .)
SUM="$(sha256sum "dist/app-updates/${ZIP}" | cut -d' ' -f1)"
printf '{"version":"%s","url":"/app-updates/%s","checksum":"%s","builtAt":"%s"}\n' "$VERSION" "$ZIP" "$SUM" "$(date -u +%FT%TZ)" > dist/app-updates/latest.json
rm -rf dist-native

# Zweite Adresse: https://mateenbatt.de/lernen/ (Basis-Pfad /lernen/, API über denselben Server unter /lernen/api)
VITE_BASE=/lernen/ VITE_API_BASE=/lernen nice -n 10 npx vite build --outDir dist-mb --emptyOutDir >/dev/null
mkdir -p /var/www/lernquest-mb
rsync -a --delete-after dist-mb/ /var/www/lernquest-mb/
rm -rf dist-mb

rsync -a --delete-after dist/ /var/www/lernquest/
echo "Auch unter https://mateenbatt.de/lernen/ (Apache-Snippet: deploy/apache/mateenbatt-lernen.inc → /etc/apache2/lernquest-mateenbatt.inc)"
echo "Web-App deployt: $(ls dist/assets | wc -l) Dateien · App-Paket ${VERSION} ($(du -h "dist/app-updates/${ZIP}" | cut -f1))"
