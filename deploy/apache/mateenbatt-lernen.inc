# LernQuest zusätzlich unter https://mateenbatt.de/lernen/ – gleiche App, gleiche API und Datenbank wie lern.varialbe.xyz.
# Eingebunden im vhost mateenbatt.de-le-ssl.conf per `Include /etc/apache2/lernquest-mateenbatt.inc`
# (Kopie dieser Datei, siehe deploy/deploy-web.sh). Build mit Basis-Pfad /lernen/ liegt in /var/www/lernquest-mb.

RedirectMatch 301 ^/lernen$ /lernen/

# --- API (Reverse Proxy, gleiche Instanz) ---
ProxyRequests Off
ProxyPass        /lernen/api/ http://127.0.0.1:3460/api/ timeout=60
ProxyPassReverse /lernen/api/ http://127.0.0.1:3460/api/
<Location /lernen/api/>
    RequestHeader set X-Forwarded-Proto "https"
    Header set Cache-Control "no-store"
</Location>

# --- Statische App (SPA-Fallback innerhalb /lernen/) ---
Alias /lernen/ /var/www/lernquest-mb/
<Directory /var/www/lernquest-mb>
    Options -Indexes -MultiViews
    AllowOverride None
    Require all granted
    FallbackResource /lernen/index.html
</Directory>

# --- Sicherheits-Header (wie lern.varialbe.xyz) ---
<Location /lernen/>
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "DENY"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
    Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
    <IfModule mod_brotli.c>
        AddOutputFilterByType BROTLI_COMPRESS text/html text/css text/plain application/javascript text/javascript application/json application/manifest+json image/svg+xml
    </IfModule>
</Location>

# --- Caching ---
<LocationMatch "^/lernen/assets/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|ttf)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
</LocationMatch>
<LocationMatch "^/lernen/(assets|app-icons)/[^/]+\.(webp|png|svg)$">
    Header set Cache-Control "public, max-age=604800"
</LocationMatch>
<LocationMatch "^/lernen/(index\.html|sw\.js|manifest\.webmanifest|registerSW\.js)?$">
    Header set Cache-Control "no-cache"
</LocationMatch>
