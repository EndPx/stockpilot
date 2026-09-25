# StockPilot on an existing VPS

This deployment runs one Next.js standalone container and private Redis. The
control plane uses a dedicated Neon PostgreSQL project. The app binds only
`127.0.0.1:3100` on the host; the existing reverse
proxy supplies HTTPS. Trading starts disabled, and no Jupiter API key is needed.
The domain and VPS must be confirmed before applying these instructions remotely.

## Prerequisites and boundaries

- Use Linux Docker Engine and Docker Compose v2.20 or newer, with an existing
  reverse proxy. Verify port 3100 is unused and allow memory/disk headroom for
  other VPS applications before starting this project. The VPS needs outbound
  access to Neon's PostgreSQL endpoint on port 5432.
- The Dockerfile builds with Node 24 Alpine and pnpm 10.21.0 using the frozen
  lockfile. `apps/web/next.config.ts` must use `output: "standalone"` with the
  repository root as `outputFileTracingRoot`.
- The runtime ceiling is 768 MiB for the app plus 256 MiB for Redis; builds need
  additional memory. Build on another compatible Linux host if the VPS cannot
  spare it, and transfer the tagged image using your existing trusted process.
- Keep this project in its own directory and Compose project namespace. Never
  replace the server's full proxy configuration or stop unrelated containers.
  If the existing proxy runs inside Docker, host loopback is not its loopback;
  adapt its private upstream connection explicitly before deploying.
- The supplied proxy contract assumes NGINX (or Caddy) receives clients directly.
  A CDN or another proxy changes the observed remote address; review trusted
  proxy configuration before adding one. Keep the app's port off public interfaces.

## Protected runtime configuration

Create `/etc/stockpilot` with mode `0700`, and a file named
`/etc/stockpilot/runtime.env` with mode `0600`, owned by the deployment operator.
Use a protected editor or secret manager; never paste real values into chat,
command history, source control, build arguments, or logs. Generate distinct
cryptographically random values locally (for example `openssl rand -hex 32`).
The file has this shape; replace every placeholder before use:

```dotenv
STOCKPILOT_IMAGE=stockpilot:release-REPLACE_WITH_COMMIT
APP_URL=https://REPLACE_WITH_APPROVED_DOMAIN
SESSION_SECRET=REPLACE_WITH_64_RANDOM_HEX_CHARACTERS
REDIS_PASSWORD=REPLACE_WITH_DIFFERENT_64_RANDOM_HEX_CHARACTERS
CONTROL_PLANE_KEY_PEPPER=REPLACE_WITH_THIRD_64_RANDOM_HEX_CHARACTERS
CONTROL_PLANE_DATABASE_URL=REPLACE_WITH_NEON_RUNTIME_CONNECTION_URL
CONTROL_PLANE_MIGRATION_URL=REPLACE_WITH_NEON_DIRECT_CONNECTION_URL
AUTH_ENABLED=true
NEXT_PUBLIC_AUTH_PROVIDER=privy
PRIVY_APP_SECRET=REPLACE_WITH_EXISTING_PROTECTED_SERVER_VALUE
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
AGENT_OAUTH_ENABLED=false
WORKOS_AUTHKIT_ISSUER=
WORKOS_API_KEY=
```

Privy is already the live authentication mode. Preserve its existing app secret,
session secret, and Redis password when updating the VPS. The auth mode is also
a public build argument; build and run the image with `privy`. Never pass the
Privy app secret as a build argument. Trading remains disabled in this release.

Use the dedicated StockPilot Neon project `aged-heart-64192941`, production
branch `br-super-paper-b3dx3inq` in Singapore. Both URLs must target that
branch's `neondb` database, use TLS with `sslmode=verify-full`, and remain
server-side secrets. Its connection pooler was disabled at the preflight check,
so the first single-container release should use the direct endpoint for both
runtime (which caps its local pool at five connections) and migration. Do not
use the `-pooler` hostname until pooling has been enabled and connectivity has
been tested. Migration must always use the direct endpoint because it holds a
session-level advisory lock across transactions. Set the URLs with a protected
editor or secret manager, not in a shell command argument or source archive.

`APP_URL` is the exact HTTPS origin, without a path. Redis rejects passwords that
are not exactly 64 hexadecimal characters, so the assembled `REDIS_URL` is safe
without URL escaping. Keep the session secret stable through ordinary deployments.
Set `AUTH_ENABLED=false` if the initial release should offer discovery only.
`INVESTMENTS_ENABLED` is hardcoded to `false` in Compose, and changing the env file
cannot enable buys. Enabling trading is a separate release/security decision.
The control plane has no transaction signer or execution tool. Keep the Neon
credentials and credential pepper stable across ordinary deployments.
The WorkOS variables are server-only. A temporary Staging OAuth demo may set
`AGENT_OAUTH_ENABLED=true` with the matching Staging issuer/key, but its key
expires and Staging must not become the permanent customer-facing environment.
WorkOS Production requires its own issuer and key; switching environments does
not migrate OAuth users or agent grants. Keep trading disabled in either case.
For an existing VPS runtime file, run `sh deploy/init-control-plane.sh` once
on that VPS; it appends only a missing pepper and prints no secrets. Add both
Neon URLs separately to the same protected file before starting the new image.

When archiving a release on Windows, use `git -c core.autocrlf=false archive`.
The repository also fixes Linux deployment asset line endings through
`.gitattributes`. Transfer only the source archive, never the local working tree
or its dotenv files.

`.dockerignore` excludes dotenv files, key files, deployment files, and local
dependencies from the build context. Runtime secrets are injected only when
containers start. Docker administrators can still inspect container environment
variables: restrict Docker access as strongly as root access. Do not publish
`docker inspect` or expanded `docker compose config` output; use `config --quiet`
for validation.

## Build and start this project

Run the following from the repository root after the host and domain are approved.
Use the same Compose project name and protected env file for all later commands.
Record the previous release tag before changing `STOCKPILOT_IMAGE`.

```sh
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml config --quiet
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml build --pull app
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml --profile migrate build migrate
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml --profile migrate run --rm migrate
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml up -d --no-build --wait
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml ps
curl --fail http://127.0.0.1:3100/api/health
```

The health endpoint checks process availability and reports feature flags; it does
not certify provider/RPC availability or Redis persistence. Verify separately that
both Compose services are healthy and the response has `investmentsEnabled: false`.
Redis publishes no host ports and belongs only to this project's internal
network. The app and one-shot migration have outbound access to Neon.
Migration is an explicit release gate with checksums for applied SQL; do not
start the new app if it fails. Rehearse it on a separate Neon branch before
the production rollout, using that branch's own pooled and direct URLs.

If the runtime database connection uses the separate `stockpilot_app` role,
apply `deploy/grant-runtime-oauth.sql` as the Neon migration owner **after** the
schema migrations and **before** enabling OAuth. Migration `0002` added the OAuth
tables after the original runtime grants; without this step, WorkOS can create a
user but StockPilot cannot bind that user to the verified Privy wallet. Verify
`SELECT`, `INSERT`, and `UPDATE` privileges on both OAuth tables for
`stockpilot_app`. The OAuth binding also locks `control_accounts` with
`SELECT ... FOR UPDATE`, which PostgreSQL requires an `UPDATE` grant to use;
grant only `UPDATE (updated_at)` there, never wallet-address updates. `DELETE`
should remain denied. Do not edit the already-applied `0002` file, because the
migration runner verifies its checksum.

### Existing NGINX host (the confirmed Hostinger VPS)

Use `stockpilot.endpx.cloud` with A record `76.13.179.205`. Preserve the apex and
every other subdomain. Store each source release under
`/opt/stockpilot/releases/<commit>` and deploy its immutable image tag. On the first
release only, `sh deploy/init-runtime.sh <commit>` generates the protected runtime
file on the VPS without printing credentials; it refuses to overwrite an existing
file. Never transfer a development dotenv file.

Install `nginx-stockpilot-http.conf` as the new site
`/etc/nginx/sites-available/stockpilot`, create its corresponding enabled symlink,
and create `/var/www/stockpilot-acme`. Validate `nginx -t` before reloading. This
temporary site serves only the ACME challenge; it does not expose the app over HTTP.
After public DNS resolves, obtain a certificate using the host's existing Certbot
account:

```sh
certbot certonly --webroot -w /var/www/stockpilot-acme -d stockpilot.endpx.cloud --non-interactive --keep-until-expiring
```

Replace only this new site file with `nginx-stockpilot.conf`, validate, and reload.
Install `renewal-hook.sh` under Certbot's `renewal-hooks/deploy/stockpilot` with
mode `0755`; it reloads NGINX only when this domain renews. The dedicated site
overwrites forwarding headers, bounds API request bodies, applies request rate
limits, and redirects HTTP to HTTPS. Do not replace the global NGINX configuration
or install another proxy on ports 80/443. Verify the existing Certbot renewal timer.

### Alternative existing Caddy host

Add the site block from `Caddyfile.example` to the existing Caddy configuration,
using the same domain as `APP_URL`. Preserve other sites, validate the complete
configuration with `caddy validate`, then reload it with the server's established
service procedure. Caddy needs correct DNS and access to ports 80/443 for automatic
HTTPS; do not start a competing proxy on those ports. The example overwrites
`X-Real-IP` for `TRUST_PROXY=true`, limits API bodies to 16 KiB, and sets HSTS only
for this hostname. The app supplies its own CSP/security headers; do not add a
second CSP at the proxy.

Check the public HTTPS landing page, Markets, private/public detail pages, wallet
connect/sign-in and read-only portfolio. Check keyboard use and narrow screens.
Confirm unauthenticated API requests fail as expected, trading stays disabled,
and the host's 3100 and 6379 ports are inaccessible from outside. These checks do
not require a buy, a wallet transaction signature, or a Jupiter key.

The legacy `deploy/smoke-auth.mjs` exercises SIWS and is not an acceptance test
for the live Privy mode. Instead, verify Google login in a browser, the generated
wallet and read-only portfolio, and authenticated Agents/Approvals API behavior.
Check that unauthenticated requests fail, agent controls persist after reload,
and trading endpoints remain disabled. Do not submit a real investment as part
of this rollout.

## Updates and rollback

Use a new release tag for every build and retain the previous working image. The
major/minor base-image tags receive updates, so record the resolved image IDs when
releasing; use reviewed digests if reproducible base images are required. Test
updates before using them on this VPS. Recreating the one app container may cause
a short interruption and requires a browser reload for already-open pages.

### Pull a reviewed commit directly from GitHub

For subsequent app-only releases, use `deploy/git-release.sh` on the VPS instead
of uploading a source archive. A maintainer must first review/test the release
and push the **full commit SHA** to `EndPx/stockpilot` `main`. The script fetches
that branch over HTTPS, requires the fetched tip to equal the supplied SHA,
checks that it descends from the running image commit, then creates a detached
release worktree under `/opt/stockpilot/releases/<sha>`. This is a pinned fetch,
not an unbounded `git pull` in the live app directory.

One-time bootstrap on the existing VPS, after independently recording the
reviewed SHA, can use a separate controller checkout. Verify its commit **before
executing the script**; do not run a script from an unexpected branch tip:

```sh
git clone --single-branch --branch main https://github.com/EndPx/stockpilot.git /opt/stockpilot/deploy-controller
: "${REVIEWED_SHA:?Set REVIEWED_SHA to the reviewed full commit SHA}"
if [ "$(git -C /opt/stockpilot/deploy-controller rev-parse HEAD)" = "$REVIEWED_SHA" ]; then
  sh /opt/stockpilot/deploy-controller/deploy/git-release.sh "$REVIEWED_SHA"
else
  echo 'Controller checkout differs from reviewed SHA; stop and review the new commit.' >&2
fi
```

The controller checkout can stay pinned for ordinary releases: its script
fetches current `origin/main` into a separate bare repository and runs the
target release's Compose file. Update the controller script only as another
reviewed change, checking its SHA again before execution. Do not put credentials
in the Git URL, repository, command line, or controller checkout. The public
source repository requires no deploy key. `runtime.env` remains in
`/etc/stockpilot`; the script reads its public auth-provider setting but never
sources, changes, copies, or prints its secret values.

The script builds `stockpilot:release-<full-sha>` with an OCI revision label,
reuses that image only if the label matches, validates Compose without showing
expanded secrets, and replaces only the `stockpilot` app service. It leaves
Redis and its volume running, does not run migrations, and verifies the local
health endpoint plus disabled trading/agent-execution flags. Save the previous
image name printed by the script. Then check the public HTTPS site and relevant
browser flows; local health alone does not prove OAuth, Neon, or RPC behavior.

If any file in `apps/web/migrations` or the migration runner changed since the
running image, the script stops before building. Such a release needs the
separate Neon migration gate **and the established manual app deployment**;
running a migration first does not make this script accept that commit. If
`origin/main` advances after review, inspect the new commit and
invoke the script with its new exact SHA rather than bypassing the pin.

On a failed app-only release, inspect the new app logs and roll back using the
**retained previous image and its matching release Compose file**. Use the exact
previous release directory and image printed by the script; legacy archive
releases used short directory names:

```sh
: "${PREVIOUS_RELEASE_DIR:?Set PREVIOUS_RELEASE_DIR from the release script output}"
: "${PREVIOUS_IMAGE:?Set PREVIOUS_IMAGE from the release script output}"
cd "$PREVIOUS_RELEASE_DIR"
STOCKPILOT_IMAGE="$PREVIOUS_IMAGE" \
  docker compose --project-name stockpilot --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml \
  up -d --no-deps --no-build --wait app
curl --fail http://127.0.0.1:3100/api/health
```

This override does not change `runtime.env`. Do not rebuild the previous tag,
remove Redis, or roll back to code incompatible with the current data. The
general rollback procedure below remains available for deployments that do
not use this Git workflow.

To roll back the app, change only `STOCKPILOT_IMAGE` in the protected env file to
the retained previous image tag, then run:

```sh
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml up -d --no-build --no-deps --wait app
curl --fail http://127.0.0.1:3100/api/health
```

Do not rebuild the old tag, discard Redis state, run `down -v`, or run a global
Docker prune as part of rollback. Confirm that the previous image supports the
current Redis key schema. Keep the session secret and disabled trading setting.
If an older release lacks the security fixes, disable public access while
recovering instead of exposing that release.

## Persistence, backup, and limits

Redis stores authentication/rate-limit state in the project-scoped `redis-data`
volume, with AOF, `appendfsync always`, a 64 MiB data limit, and `noeviction`.
Persistence errors or memory exhaustion must fail protected operations closed;
they must never cause fallback to an in-memory authorization store. Reserve disk
space for AOF rewrite and monitor memory, persistence errors, disk use, and HTTP
429/5xx rates. AOF is not a backup. Container health checks do not automatically
restart a process that is merely unhealthy; `unless-stopped` restarts exited
processes. Use the VPS's existing monitoring to detect failures.

Before backing up this volume, stop only this project's app and Redis services
using the same Compose command prefix. Take a consistent volume backup or VPS
snapshot through the operator's established backup tooling, preserving ownership,
then restart these two services. Encrypt backups and keep the env file separately
protected. Never print Redis values or credentials while diagnosing a failure.

A Redis backup may contain old nonce/revocation state. Restore into a protected
maintenance environment, rotate `SESSION_SECRET` before exposing the restored
service, and invalidate old sessions/challenges. Do not combine a stale Redis
restore with the old secret. Record the backup time and verify the restore process
before relying on it for recovery.

Back up the Neon project separately and verify a restore procedure; a VPS
snapshot does not contain Neon's managed data. Monitor Neon compute, storage,
connection failures, and the short restore window on the selected plan.

The app filesystem is read-only except bounded tmpfs mounts for `/tmp` and Next's
image cache; cached images disappear on restart. There are no host source mounts
or Docker socket mounts. Both services drop Linux capabilities, limit process and
memory use, and rotate container logs. These controls reduce exposure; they do not
provide DDoS protection, high availability, host patching, or recovery from a
compromised administrator. Keep OS/Docker/base images updated and restrict SSH.

References: [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
[Redis official image](https://hub.docker.com/_/redis),
[Caddy request-body limits](https://caddyserver.com/docs/caddyfile/directives/request_body),
[Caddy upstream headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
