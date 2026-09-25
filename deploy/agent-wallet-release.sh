#!/bin/sh
# Explicit migration + server signer setup. NEVER grants an owner wallet or submits funds.
set -eu
export LC_ALL=C
fail() { printf 'StockPilot agent release: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 1 ] || fail 'usage: sh agent-wallet-release.sh <full origin/main SHA>'
target=$1
case "$target" in *[!0-9a-f]*|'') fail 'invalid commit' ;; esac
[ "${#target}" -eq 40 ] || fail 'full commit required'
base=/opt/stockpilot
runtime=/etc/stockpilot/runtime.env
mirror=$base/source.git
release=$base/releases/$target
image=stockpilot:release-$target
migration_image=stockpilot:migration-$target
signer_directory=/etc/stockpilot/agent-execution
signer_file=$signer_directory/server.env
[ -d "$base" ] && [ ! -L "$base" ] && [ -d "$mirror" ] && [ ! -L "$mirror" ] || fail 'existing project missing'
[ -f "$runtime" ] && [ ! -L "$runtime" ] || fail 'protected runtime missing'
[ ! -L "$signer_directory" ] && [ ! -L "$signer_file" ] || fail 'signer configuration must not be symlinked'
grep -qx 'NEXT_PUBLIC_AUTH_PROVIDER=privy' "$runtime" || fail 'Privy runtime required'
[ ! -L "$base/.git-release.lock" ] || fail 'release lock must not be symlinked'
exec 9>"$base/.git-release.lock"
flock -n 9 || fail 'another release is running'
[ "$(git --git-dir="$mirror" remote get-url origin)" = https://github.com/EndPx/stockpilot.git ] || fail 'wrong repository'
git --git-dir="$mirror" fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
[ "$(git --git-dir="$mirror" rev-parse 'refs/remotes/origin/main^{commit}')" = "$target" ] || fail 'main moved'
previous_image=$(docker inspect stockpilot-app-1 --format '{{.Config.Image}}')
case "$previous_image" in stockpilot:release-*) previous=${previous_image#stockpilot:release-} ;; *) fail 'unknown rollback image' ;; esac
previous_commit=$(git --git-dir="$mirror" rev-parse "$previous^{commit}")
[ "$previous_commit" != "$target" ] || fail 'target is already live; inspect health instead of rebuilding its rollback image'
git --git-dir="$mirror" merge-base --is-ancestor "$previous_commit" "$target" || fail 'release is not a descendant'
previous_release=$base/releases/$previous
[ -f "$previous_release/deploy/compose.yml" ] || previous_release=$base/releases/$previous_commit
[ -f "$previous_release/deploy/compose.yml" ] || fail 'rollback Compose missing'
[ "$(docker inspect stockpilot-redis-1 --format '{{.State.Health.Status}}')" = healthy ] || fail 'Redis unhealthy'
if [ -e "$release" ]; then
  [ -d "$release" ] && [ ! -L "$release" ] || fail 'invalid release directory'
  [ "$(git -C "$release" rev-parse HEAD)" = "$target" ] || fail 'checkout mismatch'
  [ -z "$(git -C "$release" status --porcelain)" ] || fail 'dirty release'
else
  git --git-dir="$mirror" worktree add --detach "$release" "$target"
fi
docker build --pull --target migration --build-arg NEXT_PUBLIC_AUTH_PROVIDER=privy \
  --label "org.opencontainers.image.revision=$target" -t "$migration_image" "$release"
docker build --build-arg NEXT_PUBLIC_AUTH_PROVIDER=privy \
  --label "org.opencontainers.image.revision=$target" -t "$image" "$release"
(
  set -a
  . "$runtime"
  runtime_database=$CONTROL_PLANE_DATABASE_URL
  CONTROL_PLANE_DATABASE_URL=$CONTROL_PLANE_MIGRATION_URL
  export CONTROL_PLANE_DATABASE_URL
  docker run --rm --network stockpilot_egress --memory 384m --cpus 0.5 \
    --env CONTROL_PLANE_DATABASE_URL "$migration_image"
  # Use the same pg URL parser as the migration; pass secrets by named environment only.
  CONTROL_PLANE_DATABASE_URL=$runtime_database
  export CONTROL_PLANE_DATABASE_URL
  docker run --rm --network stockpilot_egress --memory 384m --cpus 0.5 \
    --env CONTROL_PLANE_DATABASE_URL --env CONTROL_PLANE_MIGRATION_URL \
    "$migration_image" node apps/web/scripts/grant-agent-runtime.mjs
  # Positive u64 representability ceilings only. User's per-agent limits are
  # enforced atomically by StockPilot; no hidden $0.10 demo spending cap.
  if [ ! -e "$signer_file" ]; then
    install -d -m 700 "$signer_directory"
    expiry=$(date -u -d '+6 days' '+%Y-%m-%dT%H:%M:%SZ')
    docker run --rm --user 0:0 --network stockpilot_egress --memory 384m --cpus 0.5 \
      --env PRIVY_APP_SECRET --mount "type=bind,src=$signer_directory,dst=/protected" \
      "$migration_image" node apps/web/scripts/provision-privy-execution.mjs --provision \
      --output=/protected/server.env --expires-at="$expiry" \
      --max-sol-lamports=18446744073709551615 --max-usdc-raw=18446744073709551615
  fi
  [ -f "$signer_file" ] && [ "$(stat -c %a "$signer_file")" = 600 ] || fail 'protected signer file missing'
  [ "$(stat -c %a "$signer_directory")" = 700 ] || fail 'signer directory is not protected'
  grep -Eq '^PRIVY_EXECUTION_SIGNER_ID=[A-Za-z0-9_-]+$' "$signer_file" || fail 'partial provisioning; investigate before retrying'
  grep -Eq '^PRIVY_EXECUTION_POLICY_ID=[A-Za-z0-9_-]+$' "$signer_file" || fail 'partial provisioning; investigate before retrying'
)
backup=$(mktemp /etc/stockpilot/runtime.before-agent.XXXXXX)
cp -p "$runtime" "$backup"
chmod 600 "$backup"
next_runtime=$(mktemp /etc/stockpilot/runtime.agent.XXXXXX)
awk -v image="$image" '!/^(STOCKPILOT_IMAGE|AGENT_EXECUTION_ENABLED|PRIVY_EXECUTION_SIGNER_ID|PRIVY_EXECUTION_POLICY_ID|PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY|PRIVY_EXECUTION_EXPIRES_AT)=/ { print }
  END { print "STOCKPILOT_IMAGE=" image; print "AGENT_EXECUTION_ENABLED=true" }' "$runtime" > "$next_runtime"
awk '/^PRIVY_EXECUTION_(SIGNER_ID|POLICY_ID|AUTHORIZATION_PRIVATE_KEY|EXPIRES_AT)=/ { print }' "$signer_file" >> "$next_runtime"
chmod 600 "$next_runtime"
mv "$next_runtime" "$runtime"
rollback() {
  cp -p "$backup" "$runtime"
  STOCKPILOT_IMAGE="$previous_image" docker compose --project-name stockpilot --env-file "$runtime" \
    -f "$previous_release/deploy/compose.yml" up -d --no-deps --no-build --wait app
}
if ! docker compose --project-name stockpilot --env-file "$runtime" -f "$release/deploy/compose.yml" \
  up -d --no-deps --no-build --wait app; then
  rollback; fail 'new app failed health; previous app restored'
fi
health=$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/api/health) || {
  rollback; fail 'health request failed';
}
if ! printf '%s\n' "$health" | grep -Eq '"agentExecutionEnabled"[[:space:]]*:[[:space:]]*true' ||
   ! printf '%s\n' "$health" | grep -Eq '"investmentsEnabled"[[:space:]]*:[[:space:]]*true' ||
   [ "$(docker inspect stockpilot-app-1 --format '{{.Config.Image}}')" != "$image" ]; then
  rollback; fail 'unexpected capabilities/image; previous app restored'
fi
printf '%s\n' "$health"
printf 'Live commit: %s; rollback image: %s; runtime backup: %s. No wallet delegated, no funds sent.\n' "$target" "$previous_image" "$backup"
