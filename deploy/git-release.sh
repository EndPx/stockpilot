#!/bin/sh
# Run on the existing StockPilot VPS as its deployment operator. No secrets are
# copied from GitHub; runtime.env stays in /etc/stockpilot.
set -eu

export LC_ALL=C

fail() {
  printf 'StockPilot release: %s\n' "$*" >&2
  exit 1
}

check_health() {
  health=$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3100/api/health) || fail 'local health endpoint failed; see rollback instructions'
  printf '%s\n' "$health" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' || fail 'health status is not ok'
  if grep -qx 'INVESTMENTS_ENABLED=true' "$runtime"; then
    grep -Eq '^STOCKPILOT_DEMO_TRADER_WALLET=[1-9A-HJ-NP-Za-km-z]{32,44}$' "$runtime" || fail 'demo owner wallet is missing'
    printf '%s\n' "$health" | grep -Eq '"investmentsEnabled"[[:space:]]*:[[:space:]]*true' || fail 'requested trading is not enabled'
  else
    printf '%s\n' "$health" | grep -Eq '"investmentsEnabled"[[:space:]]*:[[:space:]]*false' || fail 'trading unexpectedly enabled'
  fi
  if grep -qx 'AGENT_EXECUTION_ENABLED=true' "$runtime"; then
    printf '%s\n' "$health" | grep -Eq '"agentExecutionEnabled"[[:space:]]*:[[:space:]]*true' || fail 'agent execution is not configured'
  else
    printf '%s\n' "$health" | grep -Eq '"agentExecutionEnabled"[[:space:]]*:[[:space:]]*false' || fail 'agent execution unexpectedly enabled'
  fi
}

[ "$#" -eq 1 ] || fail 'usage: sh deploy/git-release.sh <40-character origin/main commit SHA>'
target=$1
case "$target" in
  *[!0-9a-f]*|'') fail 'commit must be a lowercase hexadecimal SHA' ;;
esac
[ "${#target}" -eq 40 ] || fail 'commit must be a full 40-character SHA'

repo=https://github.com/EndPx/stockpilot.git
base=/opt/stockpilot
mirror=$base/source.git
releases=$base/releases
release=$releases/$target
runtime=/etc/stockpilot/runtime.env
image=stockpilot:release-$target

[ -d "$base" ] && [ ! -L "$base" ] || fail 'expected /opt/stockpilot to be an existing directory, not a symlink'
[ -r "$runtime" ] && [ ! -L "$runtime" ] || fail 'protected runtime.env is missing or is a symlink'
# The live site is Privy-only. Refuse to build an image that differs from the
# runtime public auth provider, without sourcing or printing the secret file.
grep -qx 'NEXT_PUBLIC_AUTH_PROVIDER=privy' "$runtime" || fail 'expected NEXT_PUBLIC_AUTH_PROVIDER=privy in protected runtime.env'
command -v git >/dev/null 2>&1 || fail 'git is required'
command -v docker >/dev/null 2>&1 || fail 'Docker is required'
command -v curl >/dev/null 2>&1 || fail 'curl is required'
command -v flock >/dev/null 2>&1 || fail 'flock is required'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required'

lock_file=$base/.git-release.lock
[ ! -L "$lock_file" ] || fail 'deployment lock must not be a symlink'
exec 9>"$lock_file"
flock -n 9 || fail 'another StockPilot release is in progress'

if [ ! -e "$mirror" ]; then
  git init --bare "$mirror" >/dev/null
  git --git-dir="$mirror" remote add origin "$repo"
fi
[ -d "$mirror" ] && [ ! -L "$mirror" ] || fail 'Git mirror is not a normal directory'
[ "$(git --git-dir="$mirror" rev-parse --is-bare-repository)" = true ] || fail 'Git mirror is not bare'
[ "$(git --git-dir="$mirror" remote get-url origin)" = "$repo" ] || fail 'Git mirror origin differs from approved repository'

# Fetch only the approved branch, then require the caller's pinned SHA to be
# exactly the fetched branch tip. A branch move during this command fails shut.
git --git-dir="$mirror" fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
fetched=$(git --git-dir="$mirror" rev-parse --verify 'refs/remotes/origin/main^{commit}')
[ "$fetched" = "$target" ] || fail 'pinned SHA does not match the fetched origin/main tip; review the new commit and retry explicitly'

current_image=$(docker inspect --type container stockpilot-app-1 --format '{{.Config.Image}}') || fail 'existing StockPilot app container was not found'
redis_health=$(docker inspect --type container stockpilot-redis-1 --format '{{.State.Health.Status}}') || fail 'existing StockPilot Redis container was not found'
[ "$redis_health" = healthy ] || fail 'StockPilot Redis is not healthy; resolve that before replacing the app'
case "$current_image" in
  stockpilot:release-*) previous=${current_image#stockpilot:release-} ;;
  *) fail 'running StockPilot image is not a known release tag' ;;
esac
case "$previous" in
  *[!0-9a-f]*|'') fail 'running release tag has an invalid commit suffix' ;;
esac
[ "${#previous}" -ge 7 ] && [ "${#previous}" -le 40 ] || fail 'running release tag has an invalid commit length'
previous_commit=$(git --git-dir="$mirror" rev-parse --verify "$previous^{commit}") || fail 'running release commit is not present in the fetched Git history'

if [ "$previous_commit" = "$target" ]; then
  check_health
  printf 'StockPilot is already running commit %s; no container replaced.\n' "$target"
  exit 0
fi

git --git-dir="$mirror" merge-base --is-ancestor "$previous_commit" "$target" || fail 'target is not a descendant of the running release'
if ! git --git-dir="$mirror" diff --quiet "$previous_commit" "$target" -- apps/web/migrations apps/web/scripts/migrate-control-plane.mjs; then
  fail 'migration files changed; review and run the separate migration gate before an app release'
fi

mkdir -p "$releases"
[ ! -L "$releases" ] || fail 'release root must not be a symlink'
# Legacy archive releases used short directory names. Retain the exact source
# directory for rollback instead of assuming it has the full commit name.
if [ -f "$releases/$previous/deploy/compose.yml" ] && [ ! -L "$releases/$previous" ]; then
  previous_release=$releases/$previous
elif [ -f "$releases/$previous_commit/deploy/compose.yml" ] && [ ! -L "$releases/$previous_commit" ]; then
  previous_release=$releases/$previous_commit
else
  fail 'matching previous release Compose file is missing; establish rollback before deploying'
fi
if [ -e "$release" ]; then
  [ -d "$release" ] && [ ! -L "$release" ] || fail 'release path is not a normal directory'
  [ "$(git -C "$release" rev-parse --verify HEAD)" = "$target" ] || fail 'existing release checkout has a different commit'
  [ -z "$(git -C "$release" status --porcelain --untracked-files=all)" ] || fail 'existing release checkout has local changes'
else
  git --git-dir="$mirror" worktree add --detach "$release" "$target"
fi

compose_file=$release/deploy/compose.yml
[ -f "$compose_file" ] || fail 'target release has no Compose file'
STOCKPILOT_IMAGE="$image" docker compose --project-name stockpilot --env-file "$runtime" -f "$compose_file" config --quiet

# Use a commit-addressed image tag. The OCI revision label makes a partially
# completed release safe to resume without silently rebuilding a tag.
if docker image inspect "$image" >/dev/null 2>&1; then
  revision=$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')
  [ "$revision" = "$target" ] || fail 'release image tag already exists with a different or missing revision label'
else
  docker build --pull --label "org.opencontainers.image.revision=$target" \
    --build-arg NEXT_PUBLIC_AUTH_PROVIDER=privy --tag "$image" "$release"
fi

printf 'Previous release directory: %s; previous image: %s\n' "$previous_release" "$current_image"
printf 'Replacing only stockpilot app: %s -> %s\n' "$current_image" "$image"
STOCKPILOT_IMAGE="$image" docker compose --project-name stockpilot --env-file "$runtime" -f "$compose_file" \
  up -d --no-deps --no-build --wait app || fail "app did not become healthy; roll back from $previous_release using retained image $current_image"

running_image=$(docker inspect --type container stockpilot-app-1 --format '{{.Config.Image}}')
[ "$running_image" = "$image" ] || fail 'running app image differs from requested release'
check_health
# Keep subsequent operator restarts on the verified image without exposing or
# rewriting any unrelated secret. The previous image remains available above.
next_runtime=$(mktemp /etc/stockpilot/runtime.image.XXXXXX)
awk -v image="$image" '
  !/^STOCKPILOT_IMAGE=/ { print }
  END { print "STOCKPILOT_IMAGE=" image }
' "$runtime" > "$next_runtime"
chmod 600 "$next_runtime"
mv "$next_runtime" "$runtime"
printf 'StockPilot release %s is healthy. Previous release/image retained: %s / %s\n' "$target" "$previous_release" "$current_image"
