# StockPilot on an existing VPS

This deployment runs one Next.js standalone container and one private Redis
container. The app binds only `127.0.0.1:3100` on the host; the existing reverse
proxy supplies HTTPS. Trading starts disabled, and no Jupiter API key is needed.
The domain and VPS must be confirmed before applying these instructions remotely.

## Prerequisites and boundaries

- Use Linux Docker Engine and Docker Compose v2.20 or newer, with an existing
  reverse proxy. Verify port 3100 is unused and allow memory/disk headroom for
  other VPS applications before starting this project.
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
AUTH_ENABLED=true
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

`APP_URL` is the exact HTTPS origin, without a path. Redis rejects passwords that
are not exactly 64 hexadecimal characters, so the assembled `REDIS_URL` is safe
without URL escaping. Keep the session secret stable through ordinary deployments.
Set `AUTH_ENABLED=false` if the initial release should offer discovery only.
`INVESTMENTS_ENABLED` is hardcoded to `false` in Compose, and changing the env file
cannot enable buys. Enabling trading is a separate release/security decision.

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
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml up -d --no-build --wait
docker compose --env-file /etc/stockpilot/runtime.env -f deploy/compose.yml ps
curl --fail http://127.0.0.1:3100/api/health
```

The health endpoint checks process availability and reports feature flags; it does
not certify provider/RPC availability or Redis persistence. Verify separately that
both Compose services are healthy and the response has `investmentsEnabled: false`.
The Redis service publishes no host ports and belongs only to this project's
internal network. The app has a second network for outbound provider/RPC requests.

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

After confirming the exact live origin, run `node deploy/smoke-auth.mjs` from a
checkout with the workspace dependencies installed. It tests real HTTPS/Redis
authentication, replay denial, revocation, cross-origin rejection and disabled
investment endpoints using only a throwaway in-memory SIWS identity. It does not
connect a real wallet or create a financial transaction. The default run makes ten
HTTP requests, performs no RPC calls, and must print all ten named `PASS` checks.

Optionally run `node deploy/smoke-auth.mjs --portfolio` to add one authenticated
`GET /api/portfolio` after session restoration. This triggers read-only server RPC
calls and verifies the generated wallet has zero SOL/USDC balances, zero portfolio
value, and no holdings, with the response bound to that same wallet. This mode
makes eleven HTTP requests and must print eleven named `PASS` checks. It never
logs wallet addresses, keys, proofs, or cookies, and adds no financial preparation
or execution. Both modes allow at most one additional logout request for cleanup
on failure (eleven/twelve requests maximum), use a ten-second timeout per request,
and reject responses over 64 KiB. A failure exits nonzero without exposing
authentication data. Run the optional check only after confirming the live image
and its read-only RPC configuration.

## Updates and rollback

Use a new release tag for every build and retain the previous working image. The
major/minor base-image tags receive updates, so record the resolved image IDs when
releasing; use reviewed digests if reproducible base images are required. Test
updates before using them on this VPS. Recreating the one app container may cause
a short interruption and requires a browser reload for already-open pages.

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
