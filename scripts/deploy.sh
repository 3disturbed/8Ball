#!/usr/bin/env bash
# Local deploy: /root/8Ball -> /srv/darksgames/games/8ball. Run as root on the box.
# First-time registration (add-game, apps row, noindex) is a separate runbook:
# docs/IMPLEMENTATION_PLAN.md M6.
set -euo pipefail

SRC=/root/8Ball
DST=/srv/darksgames/games/8ball
NAME=8ball

cd "$SRC"
npm run check
git diff --quiet || { echo "Uncommitted changes — commit first." >&2; exit 1; }

AVAIL=$(free -m | awk '/^Mem:/{print $7}')
[ "$AVAIL" -ge 120 ] || { echo "Only ${AVAIL}MB RAM available — free memory first." >&2; exit 1; }

rsync -a --delete \
  --exclude node_modules --exclude .env --exclude db/ --exclude data/ \
  --exclude .git --exclude '*.db*' \
  "$SRC/" "$DST/"
install -d -o darks -g darks "$DST/data"
chown -R darks:darks "$DST"
sudo -u darks bash -c "cd $DST && npm ci --omit=dev --silent"

systemctl restart "darksgame@$NAME"
sleep 2
systemctl is-active --quiet "darksgame@$NAME" || {
  journalctl -u "darksgame@$NAME" -n 25 --no-pager
  exit 1
}

PORT=$(grep '^PORT=' "$DST/.env" | cut -d= -f2)
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null && echo "OK on :$PORT"
curl -fsS https://8ball.darksgames.app/healthz >/dev/null && echo "OK over TLS"
