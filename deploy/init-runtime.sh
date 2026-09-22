#!/bin/sh
# Run on the approved VPS only. Never print generated secrets.
set -eu
release="${1:?Supply the release commit ID}"
case "$release" in *[!a-f0-9]*|'') echo 'Invalid release ID' >&2; exit 1 ;; esac
[ "${#release}" -ge 7 ] && [ "${#release}" -le 40 ]
if [ -e /etc/stockpilot/runtime.env ]; then
  echo 'Existing runtime.env preserved. Update only STOCKPILOT_IMAGE for a new release.' >&2
  exit 1
fi
install -d -m 0700 /etc/stockpilot
umask 077
session_secret="$(openssl rand -hex 32)"
redis_password="$(openssl rand -hex 32)"
printf '%s\n' \
  "STOCKPILOT_IMAGE=stockpilot:release-$release" \
  'APP_URL=https://stockpilot.endpx.cloud' \
  "SESSION_SECRET=$session_secret" \
  "REDIS_PASSWORD=$redis_password" \
  'AUTH_ENABLED=true' \
  'SOLANA_RPC_URL=https://api.mainnet-beta.solana.com' \
  > /etc/stockpilot/runtime.env
unset session_secret redis_password
chmod 0600 /etc/stockpilot/runtime.env
echo 'Protected runtime configuration created; financial execution remains disabled.'
