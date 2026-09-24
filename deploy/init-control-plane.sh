#!/bin/sh
# Add only missing control-plane secrets to an existing protected runtime file.
set -eu
file=/etc/stockpilot/runtime.env
[ -f "$file" ] || { echo 'StockPilot runtime configuration not found' >&2; exit 1; }
[ ! -L "$file" ] || { echo 'Refusing a symlinked runtime file' >&2; exit 1; }
chmod 0600 "$file"
umask 077
if ! grep -q '^CONTROL_PLANE_KEY_PEPPER=' "$file"; then
  printf 'CONTROL_PLANE_KEY_PEPPER=%s\n' "$(openssl rand -hex 32)" >> "$file"
fi
echo 'Control-plane pepper is present; existing runtime values were preserved.'
echo 'Configure protected Neon runtime and direct migration URLs separately before deployment.'
