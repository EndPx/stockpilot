#!/bin/sh
# Explicit migration + enablement gate for the owner-signed two-product demo.
# Run on the existing StockPilot VPS; all runtime secrets remain on that host.
set -eu
export LC_ALL=C
fail() { printf 'StockPilot manual release: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 2 ] || fail 'usage: sh manual-demo-release.sh <full origin/main SHA> <demo public wallet>'
target=$1
wallet=$2
case "$target" in *[!0-9a-f]*|'') fail 'invalid commit' ;; esac
[ "${#target}" -eq 40 ] || fail 'full commit required'
printf '%s\n' "$wallet" | grep -Eq '^[1-9A-HJ-NP-Za-km-z]{32,44}$' || fail 'invalid public wallet'
base=/opt/stockpilot
runtime=/etc/stockpilot/runtime.env
mirror=$base/source.git
release=$base/releases/$target
image=stockpilot:release-$target
migration_image=stockpilot:migration-$target
[ -d "$base" ] && [ ! -L "$base" ] && [ -d "$mirror" ] && [ ! -L "$mirror" ] || fail 'existing project missing'
[ -f "$runtime" ] && [ ! -L "$runtime" ] || fail 'protected runtime missing'
grep -qx 'NEXT_PUBLIC_AUTH_PROVIDER=privy' "$runtime" || fail 'Privy runtime required'
command -v psql >/dev/null || fail 'psql required for explicit runtime grants'
exec 9>"$base/.git-release.lock"
flock -n 9 || fail 'another release is running'
[ "$(git --git-dir="$mirror" remote get-url origin)" = https://github.com/EndPx/stockpilot.git ] || fail 'wrong repository'
git --git-dir="$mirror" fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
[ "$(git --git-dir="$mirror" rev-parse 'refs/remotes/origin/main^{commit}')" = "$target" ] || fail 'main moved; review its new commit'
previous_image=$(docker inspect stockpilot-app-1 --format '{{.Config.Image}}')
case "$previous_image" in stockpilot:release-*) previous=${previous_image#stockpilot:release-} ;; *) fail 'unknown rollback image' ;; esac
previous_commit=$(git --git-dir="$mirror" rev-parse "$previous^{commit}")
git --git-dir="$mirror" merge-base --is-ancestor "$previous_commit" "$target" || fail 'release is not a descendant'
previous_release=$base/releases/$previous
[ -f "$previous_release/deploy/compose.yml" ] || previous_release=$base/releases/$previous_commit
[ -f "$previous_release/deploy/compose.yml" ] || fail 'rollback Compose missing'
[ "$(docker inspect stockpilot-redis-1 --format '{{.State.Health.Status}}')" = healthy ] || fail 'Redis unhealthy'
if [ -e "$release" ]; then
  [ -d "$release" ] && [ ! -L "$release" ] || fail 'invalid release directory'
  [ "$(git -C "$release" rev-parse HEAD)" = "$target" ] || fail 'release checkout mismatch'
  [ -z "$(git -C "$release" status --porcelain)" ] || fail 'release checkout is dirty'
else
  git --git-dir="$mirror" worktree add --detach "$release" "$target"
fi
docker build --pull --target migration --build-arg NEXT_PUBLIC_AUTH_PROVIDER=privy \
  --label "org.opencontainers.image.revision=$target" -t "$migration_image" "$release"
docker build --build-arg NEXT_PUBLIC_AUTH_PROVIDER=privy \
  --label "org.opencontainers.image.revision=$target" -t "$image" "$release"

# Docker receives only the migration URL by environment name; never print it.
(
  set -a
  . "$runtime"
  runtime_database=$CONTROL_PLANE_DATABASE_URL
  CONTROL_PLANE_DATABASE_URL=$CONTROL_PLANE_MIGRATION_URL
  export CONTROL_PLANE_DATABASE_URL
  docker run --rm --network stockpilot_egress --memory 384m --cpus 0.5 \
    --env CONTROL_PLANE_DATABASE_URL "$migration_image"
  PGPORT=5432 PGSSLROOTCERT=system PGCONNECT_TIMEOUT=10 \
    psql -X -w --dbname="$CONTROL_PLANE_MIGRATION_URL" -v ON_ERROR_STOP=1 -f "$release/deploy/grant-runtime-manual-trades.sql"
  privileges=$(PGPORT=5432 PGSSLROOTCERT=system PGCONNECT_TIMEOUT=10 \
    psql -X -w --dbname="$runtime_database" -Atqc "SELECT has_table_privilege(current_user, 'control_manual_investment_executions', 'SELECT') AND has_table_privilege(current_user, 'control_manual_investment_executions', 'INSERT') AND has_table_privilege(current_user, 'control_manual_investment_executions', 'UPDATE') AND has_table_privilege(current_user, 'control_manual_execution_events', 'SELECT') AND has_table_privilege(current_user, 'control_manual_execution_events', 'INSERT') AND NOT has_table_privilege(current_user, 'control_manual_investment_executions', 'DELETE') AND NOT has_table_privilege(current_user, 'control_manual_execution_events', 'UPDATE, DELETE')")
  [ "$privileges" = t ] || fail 'runtime ledger privileges differ from expected grants'
  PGPORT=5432 PGSSLROOTCERT=system PGCONNECT_TIMEOUT=10 \
    psql -X -w --dbname="$runtime_database" -Atqc 'SELECT count(*) AS existing_manual_trades FROM control_manual_investment_executions'
)

INVESTMENTS_ENABLED=true STOCKPILOT_DEMO_TRADER_WALLET="$wallet" STOCKPILOT_IMAGE="$image" \
  docker compose --project-name stockpilot --env-file "$runtime" -f "$release/deploy/compose.yml" config --quiet
backup=$(mktemp /etc/stockpilot/runtime.before-manual.XXXXXX)
cp -p "$runtime" "$backup"
chmod 600 "$backup"
next_runtime=$(mktemp /etc/stockpilot/runtime.next.XXXXXX)
awk -v image="$image" -v wallet="$wallet" '
  !/^(STOCKPILOT_IMAGE|INVESTMENTS_ENABLED|STOCKPILOT_DEMO_TRADER_WALLET)=/ { print }
  END { print "STOCKPILOT_IMAGE=" image; print "INVESTMENTS_ENABLED=true"; print "STOCKPILOT_DEMO_TRADER_WALLET=" wallet }
' "$runtime" > "$next_runtime"
chmod 600 "$next_runtime"
mv "$next_runtime" "$runtime"
rollback() {
  cp -p "$backup" "$runtime"
  STOCKPILOT_IMAGE="$previous_image" docker compose --project-name stockpilot --env-file "$runtime" \
    -f "$previous_release/deploy/compose.yml" up -d --no-deps --no-build --wait app
}
if ! docker compose --project-name stockpilot --env-file "$runtime" -f "$release/deploy/compose.yml" \
  up -d --no-deps --no-build --wait app; then
  rollback
  fail 'new app failed health; previous app restored'
fi
health=$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/api/health) || {
  rollback; fail 'health request failed; previous app restored';
}
if ! printf '%s\n' "$health" | grep -Eq '"investmentsEnabled"[[:space:]]*:[[:space:]]*true' ||
   ! printf '%s\n' "$health" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' ||
   ! printf '%s\n' "$health" | grep -Eq '"agentExecutionEnabled"[[:space:]]*:[[:space:]]*false'; then
  rollback
  fail 'unexpected feature flags; previous app restored'
fi
[ "$(docker inspect stockpilot-app-1 --format '{{.Config.Image}}')" = "$image" ] || {
  rollback; fail 'running image differs; previous app restored';
}
printf '%s\n' "$health"
printf 'Live commit: %s; rollback image: %s; protected runtime backup: %s\n' "$target" "$previous_image" "$backup"
