#!/usr/bin/env bash
# Driftsätter Theatre of War på Vultr-boxen (samma som Marble & Mayhem): statiska filer via Caddy (automatisk HTTPS)
# och onlineservern som systemd-tjänst bakom /ws. Idempotent: kör igen för att uppdatera.
#
#   tools/deploy.sh                       # bygg + skicka + starta om
#   CADDY=0 tools/deploy.sh               # hoppa över Caddy (t.ex. innan DNS-posten slagit igenom)
#
# Kräver: ssh-nyckel till root@HOST och A-posten theatreofwar.bjarby.com -> HOST (one.com, DNS-inställningar).
set -euo pipefail
HOST=${HOST:-root@70.34.220.159}
DOMAIN=${DOMAIN:-theatreofwar.bjarby.com}
APP=/opt/theatre-of-war
DATA=/var/lib/theatre-of-war
PORT=${PORT:-8263}
CADDY=${CADDY:-1}
cd "$(dirname "$0")/.."

echo "› bygger"
npm run build >/dev/null

# servern behöver bara ws (SQLite är inbyggt i Node 22) och den delade motorn
mkdir -p build/deploy
node -e "
const p = require('./package.json');
const out = { name: 'theatre-of-war-server', private: true, type: 'module', dependencies: { ws: p.dependencies.ws } };
require('fs').writeFileSync('build/deploy/package.json', JSON.stringify(out, null, 2));
"

echo "› skickar till $HOST:$APP"
ssh "$HOST" "mkdir -p $APP/dist $APP/server $APP/shared"
rsync -az --delete dist/ "$HOST:$APP/dist/"
rsync -az --delete --exclude data server/ "$HOST:$APP/server/"
rsync -az --delete shared/ "$HOST:$APP/shared/"
rsync -az build/deploy/package.json "$HOST:$APP/package.json"

echo "› installerar och startar"
ssh "$HOST" APP="$APP" DATA="$DATA" PORT="$PORT" DOMAIN="$DOMAIN" CADDY="$CADDY" bash -s <<'REMOTE'
set -euo pipefail
id theatre >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin theatre
mkdir -p "$DATA" && chown theatre "$DATA"
cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null

cat > /etc/systemd/system/theatre-of-war.service <<UNIT
[Unit]
Description=Theatre of War onlineserver
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
User=theatre
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=DB=$DATA/theatre.db
Environment=TRUST_PROXY=1
Environment=AI_DELAY_MS=900
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
MemoryMax=400M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable theatre-of-war >/dev/null 2>&1
systemctl restart theatre-of-war

if [ "$CADDY" = 1 ] && ! grep -q "^$DOMAIN {" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  cat >> /etc/caddy/Caddyfile <<CADDY

$DOMAIN {
    encode zstd gzip

    handle /ws {
        reverse_proxy localhost:$PORT
    }

    handle {
        root * $APP/dist
        @immutable path /assets/*
        header @immutable Cache-Control "public, max-age=31536000, immutable"
        @media path /models/* /audio/* /reel/* /tex/* /fonts/* /map/*
        header @media Cache-Control "public, max-age=86400"
        try_files {path} /index.html
        file_server
    }
}
CADDY
fi
if [ "$CADDY" = 1 ]; then
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl reload caddy
fi
sleep 1
systemctl is-active theatre-of-war
REMOTE
echo "› klart: https://$DOMAIN"
