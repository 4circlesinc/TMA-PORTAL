# tma-portal

tma-portal - TM ANTOINE Advisory application based on the [Portal Design](https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design) Figma file.

## Stack

- **Laravel 13** (PHP 8.4.1+ — `composer.json` still says `^8.3`, but `composer.lock`
  pins Symfony 8.1 packages that require `>=8.4.1`; the containers run 8.5)
- **Blade** components in `resources/views/components/`
- **Support classes** in `app/Support/`
- Static assets in `public/`

## Local setup

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan serve
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Deploy to Laravel Cloud

1. Push this repo to GitHub, GitLab, or Bitbucket.
2. Create a new application at [cloud.laravel.com](https://cloud.laravel.com).
3. Connect the repository - Laravel Cloud auto-detects Laravel.
4. Set environment variables (minimum):
   - `APP_KEY` - run `php artisan key:generate --show` locally and paste the value
   - `APP_ENV=production`
   - `APP_DEBUG=false`
5. **Build command:** `composer install --no-dev --optimize-autoloader`
6. **Deploy command:** `php artisan migrate --force` (optional until you add migrations)
7. Deploy.

## Running with Docker

Docker provides the entire runtime — PHP, extensions, Postgres, Redis, the
websocket server and the asset toolchain. Nothing but Docker needs to be
installed on the host, and the same images run on macOS, Linux and Windows.

### 1. Prerequisites

- **Docker Desktop 4.x+** (macOS/Windows) or **Docker Engine 24+ with the Compose
  plugin** (Linux). Check with `docker compose version` — it must be v2.
- ~8 GB of memory allocated to Docker and ~10 GB of free disk.
- Nothing else. No PHP, no Node, no composer, no Postgres, no Redis.

Installing Docker:

| Platform | How |
|----------|-----|
| macOS | [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/) — pick the Apple-silicon or Intel build to match your Mac |
| Windows | [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/) with the WSL 2 backend. **Clone the repository inside the WSL filesystem** (`\\wsl$\...`), not under `C:\Users\...` — bind mounts across the Windows/WSL boundary are dramatically slower |
| Linux | [Docker Engine](https://docs.docker.com/engine/install/) + [the Compose plugin](https://docs.docker.com/compose/install/linux/), then add yourself to the `docker` group |

### 2. Starting the project

```bash
docker compose up
```

That is the whole setup. On the first run it builds the image, starts Postgres
and Redis, waits for both to report healthy, runs all 155 migrations, seeds one
administrator, and then starts the web server, a queue worker, the scheduler and
Reverb. Expect 3–5 minutes the first time and a few seconds after that.

Open **<http://localhost:8001>** and sign in with `admin@localhost` / `password`.

> Use `localhost`, never `127.0.0.1`. Entra only accepts the literal `localhost`
> for loopback OAuth callbacks, and only `localhost` counts as a browser *secure
> context* — on any other plain-http origin, calling, screen share and voice
> notes fail silently.

**Port 8001 must be free.** If you already run `php artisan serve`, stop it
first — Docker replaces it. To use a different port:

```bash
TMA_APP_PORT=8080 docker compose up
```

nginx inside the container listens on that same number, so the app, the browser
and PHP's own broadcaster all keep agreeing on one URL,

but note that the Microsoft app registration pins its redirect URI to
`http://localhost:8001/auth/social/microsoft/callback`, so social sign-in only
works on 8001 unless you register the other port with the provider.

Add `-d` to run in the background:

```bash
docker compose up -d
```

### 3. Stopping the project

```bash
docker compose down          # stops and removes containers; DATA IS KEPT
docker compose stop          # just stops them, ready to `start` again
```

`docker compose down` is safe: the database lives in a named volume that
survives it. See *Resetting development data* for the destructive form.

### 4. Rebuilding containers

```bash
docker compose build                 # rebuild after changing docker/ or the lock files
docker compose build --no-cache app  # rebuild ignoring the layer cache
docker compose up -d --build         # rebuild and restart in one step
```

You do **not** need to rebuild after editing PHP, CSS, JS or Blade — the working
tree is bind-mounted and picked up immediately. Rebuild when you change
`docker/**`, `composer.json`/`composer.lock`, or `package-lock.json`.

`composer.lock` changes are handled without a rebuild too: the entrypoint
notices the lock hash moved and reinstalls into the container-managed `vendor`
volume on the next `docker compose up`.

### 5. Viewing logs

```bash
docker compose logs -f              # everything, interleaved
docker compose logs -f app          # nginx + php-fpm + Laravel
docker compose logs -f queue        # the queue worker
docker compose logs -f scheduler    # the 18 scheduled tasks
docker compose ps                   # service status and health
```

All application logs go to stdout/stderr (`LOG_CHANNEL=stderr`), so
`docker compose logs` is the single place to look. With `MAIL_MAILER=log`,
outgoing mail lands there too — invitation, password-reset and signature links
are clickable straight out of the log.

### 6. Running migrations

Migrations run automatically on every `docker compose up`, as a one-shot
`migrate` service that everything else waits on. To run them by hand:

```bash
docker compose run --rm migrate                                   # the same thing
docker compose exec app php artisan migrate --force               # ad hoc
docker compose exec app php artisan migrate:status
docker compose exec app php artisan migrate:rollback --step=1
```

Any artisan command works the same way:

```bash
docker compose exec app php artisan tinker
docker compose exec app php artisan route:list
docker compose exec app composer require some/package
```

### 7. Running tests

The suite runs against SQLite in memory (`phpunit.xml`), so it needs no services:

```bash
docker build -f docker/Dockerfile --target test -t tma-portal:test .
docker run --rm tma-portal:test                                   # full suite
docker run --rm tma-portal:test php artisan test --filter=PortalAccessTest
```

Or inside the running stack:

```bash
docker compose exec app php artisan test
```

> Six tests fail on `main` today, and they fail identically on the host
> (`ClientHubSettingsTest`, `ExampleTest`, `LiveTableUpdatesTest`, and three in
> `WorkPlanTest`). They are pre-existing, not caused by Docker: the host and the
> container both report 1635 passed / 6 failed out of 1641.

### 8. Resetting development data

```bash
docker compose down -v
```

**This is destructive.** `-v` removes the named volumes, which means the entire
development database and the container-managed `vendor` directory. There is no
undo and no backup is taken. The next `docker compose up` re-migrates from
scratch and re-seeds the single administrator — you get an empty portal.

Use it when the schema is wedged or you want a clean slate. For everything else,
plain `docker compose down` keeps your data.

To back up or restore the development database instead:

```bash
# Back up
docker compose exec -T postgres pg_dump -U tma -Fc tma > backup.dump

# Restore (into a running, empty database)
docker compose exec -T postgres pg_restore -U tma -d tma --clean --if-exists < backup.dump

# Plain SQL, if you prefer
docker compose exec -T postgres pg_dump -U tma tma | gzip > backup.sql.gz
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U tma -d tma
```

Connect a GUI client to `localhost:5433` (user `tma`, password `tma`, database
`tma`). Port **5433**, not 5432, so a Postgres already installed on the host
does not collide.

### 9. Rebuilding the CSS/JS bundles

Assets are optional in development — with no `public/build` manifest the shell
serves its raw tags exactly as it always has. To build them without installing
Node:

```bash
docker compose run --rm assets
```

The production image always builds them, in a discarded Node stage.

### 10. Environment variables

Three files, and they do not overwrite each other:

| File | Role |
|------|------|
| `.env` | **Not used by any container.** It points at the live Laravel Cloud database. Compose mounts an empty file over it inside the container so it cannot be read by accident. `.env.backup` is masked the same way — it carries the same production credentials and the bind mount would otherwise hand a readable copy to every container. `.env.production` is deliberately *not* masked: bind-mounting onto a missing path makes Docker create it, and an empty `.env.production` would silently satisfy the production stack's own "you must write this file" guard |
| `.env.docker.example` | Committed, complete, safe defaults. Compose reads this first. Editing it is not required |
| `.env.docker` | Yours, gitignored, optional. Compose reads it second, so anything in it wins |

To override something:

```bash
cp .env.docker.example .env.docker   # then edit, or just write the few keys you want
docker compose up -d
```

Why `.env` is masked: its `jobs` table is shared with the running production
deployment. A worker container that read it would not merely *see* production —
it would pop and execute real jobs, sending real mail and writing to real
SharePoint. The empty-file mount removes that possibility entirely.

> **Never write `${SOMETHING}` in `.env.docker.example` or `.env.docker`.**
> Compose expands `${...}` in an env file *on the host*, before the container
> exists, and it resolves those names against the project's `.env` — the
> production one. Masking `.env` inside the container does not help, because
> the substitution already happened. This is not hypothetical: the template
> once carried `VITE_REVERB_APP_KEY="${REVERB_APP_KEY}"`, and every container
> was handed the live Laravel Cloud Reverb key instead of the local one. Write
> literal values only.

The values that must differ inside Docker, and why:

| Key | Docker value | Reason |
|-----|--------------|--------|
| `DB_CONNECTION` | `pgsql` | Unset falls back to `sqlite` — the app then boots silently against an empty file with no error |
| `DB_HOST` | `postgres` | Compose service name, not `localhost` |
| `REDIS_HOST` | `redis` | Same |
| `CACHE_STORE` | `redis` | 11 jobs use `ShouldBeUnique` and 13 schedule entries use `withoutOverlapping()`; those locks live in the cache store. A per-container file cache silently breaks them once web and workers are separate processes |
| `DB_QUEUE_RETRY_AFTER` | `1900` | The default 90s is below eight jobs' own timeouts, so a second worker re-runs a job that is still in flight |
| `MAIL_PHOTOS_QUEUE` | `mail-photos` | Otherwise the dedicated photo worker consumes nothing |
| `LOG_CHANNEL` | `stderr` | So `docker compose logs` works |
| `APP_MAINTENANCE_DRIVER` | `cache` | `file` would take only one replica offline |
| `APP_MAINTENANCE_STORE` | `redis` | the driver is `cache`, and the store otherwise defaults to the database — so every request would pay a Postgres round trip just to ask whether the site is down |
| `REVERB_HOST` / `REVERB_PORT` | *per service* | See below |
| `FILES_DISK` / `AVATAR_DISK` | `local` / `public` | No S3 credentials needed. Setting `s3` without `AWS_DEFAULT_REGION` throws on the first file operation; with a region but no credentials it hangs on the EC2 metadata service |

**The Reverb split.** `REVERB_HOST`/`REVERB_PORT`/`REVERB_SCHEME` are read from
two different network vantage points: by PHP when it broadcasts, and by the
*browser*, which receives them from `GET /me`. Compose therefore sets them per
service — `localhost:8001` on `app`, `reverb:8080` on the workers — and nginx
inside the `app` container proxies `/app/` and `/apps/` to Reverb so both
vantage points resolve to the same server. Reverb is never published to the host.

`APP_KEY` in `.env.docker.example` is a **public development key**. The
entrypoint refuses to start with `APP_ENV=production` while it is set.

### 11. Production deployment

```bash
cp .env.docker.example .env.production     # then edit it — see below
docker compose -f compose.prod.yaml up -d --build
```

`compose.prod.yaml` is standalone, not an override, so no development setting
can leak into it by inheritance. Compared with development it uses the `prod`
build target (no dev dependencies, no Xdebug, no git/unzip, source baked in
rather than bind-mounted, assets prebuilt), caches config/routes/views at
startup, runs two queue workers plus a dedicated `mail-photos` worker, binds to
loopback, and rotates its container logs.

Before the first start, `.env.production` must set:

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_KEY=<the real production key>
APP_PREVIOUS_KEYS=<the real previous keys>
APP_URL=https://portal.example.com
SESSION_SECURE_COOKIE=true
POSTGRES_PASSWORD=<a real password>
DB_PASSWORD=<the same password>
REVERB_APP_ID=...  REVERB_APP_KEY=...  REVERB_APP_SECRET=...
FILES_DISK=s3  AVATAR_DISK=s3  AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...
AWS_BUCKET=...  AWS_ENDPOINT=...  AWS_DEFAULT_REGION=auto
MAIL_MAILER=microsoft-graph  MICROSOFT_GRAPH_TENANT_ID=<tenant GUID>
```

> **`APP_KEY` is not a formality.** `ConnectedAccount.token` uses the `encrypted`
> cast, so a different key makes every stored Microsoft and Google OAuth token
> permanently undecryptable — every user would have to reconnect their mailbox
> and calendar. Carry `APP_PREVIOUS_KEYS` across too. Never run
> `artisan key:generate` against a database that has real accounts in it.

**TLS and the reverse proxy.** The stack speaks plain HTTP on 8001 and expects
something in front of it:

```
Internet → TLS proxy (nginx / Caddy / Traefik / a cloud LB) → app:8001 → postgres
```

`bootstrap/app.php` calls `trustProxies(at: '*')`, so that proxy **must
overwrite** `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` rather
than pass a client's through — otherwise anyone can spoof their own address and
scheme. That is why `compose.prod.yaml` binds to `127.0.0.1` by default. Set
`TMA_APP_BIND=0.0.0.0` only when something else provides that boundary.

The proxy must also forward websocket upgrades for `/app/` and `/apps/`, and
`TMA_REVERB_PUBLIC_HOST` / `_PORT` / `_SCHEME` must describe the *public* URL
(e.g. `portal.example.com` / `443` / `https`) — that is what the browser is told
to connect to.

> **That same URL must also be reachable from inside the `app` container.**
> `config/broadcasting.php` reads one `REVERB_HOST`/`PORT`/`SCHEME` triple for
> *both* the browser and PHP's own broadcaster, and the broadcast events are
> `ShouldBroadcastNow` — sent synchronously during a web request. In development
> that costs nothing, because the container listens on the same port it is
> published on and the hop is a loopback call to its own nginx. Behind a public
> TLS proxy it would otherwise leave the container, cross the internet and come
> back. Pin the public hostname to the proxy on the Docker network so the hop
> stays local:
>
> ```yaml
> app:
>   extra_hosts:
>     - "portal.example.com:172.18.0.9"   # the TLS proxy on this network
> ```
>
> Without it, broadcasts still work but pay a full internet round trip per
> event — and if the container cannot resolve the public name at all, they fail
> *silently*, because `Live.php` swallows broadcast errors. The symptom is "the
> portal feels stale", never an error.

Set `APP_ENV=production` only when TLS is actually terminated in front:
`AppServiceProvider` forces `https://` on every generated URL when it sees that
exact string.

**Scaling.** `queue` scales freely (`--scale queue=4`). `scheduler` and `reverb`
must stay at exactly one replica — no scheduled task uses `->onOneServer()`, and
Reverb's scaling backplane is off by default, so a second instance would
silently split clients into groups that cannot see each other.

**Persistent data.** `pgdata`, `storage_private`, `storage_public` and `logs`
are named volumes. The two `storage_*` volumes are the roots of the `local` and
`public` disks, and they are shared by the web, worker and scheduler containers
because a worker writes files the web container has to serve — mail sender
photos, generated thumbnails, messaging attachments. Without that sharing those
images 404 forever, and anything left in a container's own writable layer is
discarded on the next redeploy, which silently loses every uploaded avatar.

Those volumes start empty, which would hide the content committed to the
repository — 285 vault documents that `files` rows with `disk='local'` resolve
against, plus messaging attachments and avatars. The image carries a seed copy at
`/opt/tma/seed`, and the entrypoint restores it into an empty volume **once**,
recording a stamp so it does not run again. That distinction matters: copying on
every start would treat "absent" as "missing", so a document an administrator
deleted through the portal would reappear at the next restart.

Back up `pgdata`, and the `storage_*` volumes too unless `FILES_DISK=s3`:

```bash
docker run --rm -v tma-portal-prod_storage_private:/data -v "$PWD:/backup" \
  alpine tar czf /backup/storage-private.tar.gz -C /data .
```

**`APP_URL` in production** is your real public URL and is not derived from
`TMA_APP_PORT`; set it in `.env.production`. Anything Laravel renders without a
request context — the scheduler's reminder emails, queued notifications — builds
its links from it.

### 12. Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `ports are not available: ... 8001: bind: address already in use` | Something else owns the port — usually a leftover `php artisan serve`. Stop it, or run `TMA_APP_PORT=8080 docker compose up` |
| Same for `5433` | A Postgres is already on that port. `TMA_DB_PORT=5434 docker compose up` |
| `dependency failed to start: container ... is unhealthy` | Read `docker compose logs postgres`. After a Postgres major-version change the old volume is incompatible: `docker compose down -v` (destroys data) |
| App answers 502 | php-fpm is not up yet or crashed. `docker compose logs app` |
| Redirects or asset URLs lose the port, or are `http` behind TLS | Whatever proxies the app is not sending `X-Forwarded-Host` / `X-Forwarded-Proto` |
| Blank page, or every asset 404s | A stale `public/build`. Re-run `docker compose run --rm assets`, or delete `public/build` — the shell falls back to raw tags |
| `could not find driver` | The image was built without `pdo_pgsql`. `docker compose build --no-cache app` |
| `No application encryption key has been specified` | `APP_KEY` is not reaching the container. Check `docker compose exec app printenv APP_KEY` |
| Changes to PHP files do nothing | You are on the `prod` target, which bakes the source in. Development uses `compose.yaml` |
| Jobs never run | `docker compose ps queue`. Also check `docker compose exec app php artisan queue:failed` |
| Websocket will not connect | `curl -i --max-time 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Version: 13' 'http://localhost:8001/app/tma-local-key?protocol=7&client=js&version=8.4.0'` should return `101` |
| Calls or screen share silently fail | You are not on `localhost` or HTTPS. Browsers only grant camera/microphone/screen capture in a secure context |
| Reaching the stack from a phone on the LAN | `TMA_APP_BIND=0.0.0.0 TMA_APP_HOST=<your-lan-ip> docker compose up`. Both are needed: the bind opens the port, and the host is what the browser is told to use for the websocket |
| Slow on macOS | Expected for bind mounts. `vendor/` and `node_modules/` are already container-managed volumes for this reason. Make sure VirtioFS is selected in Docker Desktop |
| Permission denied writing to `storage/` on Linux | Your host uid is not 1000. Rebuild with `TMA_UID=$(id -u) TMA_GID=$(id -g) docker compose build` |
| Want a debugger | `XDEBUG_MODE=debug docker compose up app`, then connect your IDE to port 9003 |

### What runs, and why

| Service | Image | Why it is separate |
|---------|-------|--------------------|
| `app` | built | nginx + php-fpm under supervisor. nginx is *in* this container so the websocket is same-origin with the app |
| `postgres` | `postgres:18-bookworm` | Matches the managed Postgres 18 in production. Also holds sessions and the queue |
| `redis` | `redis:8-alpine` | Cache and, more importantly, the lock store the job deduplication depends on |
| `migrate` | built | One-shot, so N app replicas cannot race 155 migrations |
| `queue` | built | Long-running worker; must not share a process with the web server |
| `scheduler` | built | 18 tasks, five of them every minute; must be resident and singular |
| `reverb` | built | An event-loop server; cannot live inside php-fpm |
| `assets` | `node:22-bookworm-slim` | Profile-gated tool, not a service. Never starts with `up` |

Deliberately **not** created: a separate frontend container (there is no Vite —
`npm run build` is a one-shot esbuild concatenation), a separate nginx container
(it would break the same-origin websocket trick), MinIO (nothing hard-codes S3),
and a mail catcher (`MAIL_MAILER=log` puts mail in `docker compose logs`).

The `desktop/` Electron app is a *client* of this server and is not part of the
Docker stack — its build is macOS-only. Point it at the stack with
`TMA_PORTAL_URL=http://localhost:8001`.

### Why these versions

| Pin | Reason |
|-----|--------|
| `php:8.5-fpm-bookworm` | `composer.lock` holds 17 Symfony 8.1 packages requiring `>=8.4.1`, and `setasign/fpdi` and `nette/*` cap at 8.5 — the usable window is 8.4.1 ≤ PHP < 8.6. Debian, not Alpine: `GLOB_BRACE` is unimplemented in musl and `PublishDesktopRelease` depends on it, and musl's `iconv //TRANSLIT` changes FPDI signature-PDF output |
| `postgres:18-bookworm` | Production runs managed Postgres 18 |
| `redis:8-alpine` | Current stable; used only as a cache and lock store, so nothing depends on its libc |
| `node:22-bookworm-slim` | Build-only. `vite@8` requires ≥22.12; esbuild needs far less. Discarded before the runtime image |
| PHP extensions | `pdo_pgsql gd zip exif pcntl intl bcmath`, each traced to real code — `gd` must be built `--with-webp` because `Messaging\Thumbnailer` calls `imagecreatefromwebp`, and `ZipArchive` is used with no `extension_loaded` guard. OPcache is compiled into PHP 8.5 already |

Both `linux/amd64` and `linux/arm64` are supported by every base image, so the
same Dockerfile builds on Apple silicon and deploys to x86 servers:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f docker/Dockerfile --target prod -t your-registry/tma-portal:1.0 --push .
```

### Continuous integration

The image is CI-ready as-is:

```bash
docker build -f docker/Dockerfile --target test -t tma-portal:test .   # test stage
docker run --rm tma-portal:test                                        # run the suite
docker build -f docker/Dockerfile --target prod -t tma-portal:$SHA .   # ship it
```

The test stage needs no database, no Redis and no network — `phpunit.xml` pins
the suite to SQLite in memory.

## Figma connection

Design reference is stored in `design/`:

| File | Purpose |
|------|---------|
| `design/figma.json` | File key, node IDs, MCP tool map |
| `design/tokens.json` | Colors, typography, spacing from Figma variables |
| `design/screens.json` | Desktop & mobile screen inventory |
| `design/illustrations.json` | Illustration catalog |
| `design/emoji.json` | Fluent Emoji catalog |
| `design/avatars.json` | Avatar asset catalog |
| `design/avatar-names.json` | Name → avatar mapping (user chips) |
| `design/avatar-usage.md` | Laravel Blade usage examples |

Connected via Figma MCP as **Vernon Francis** (`igraphixmarketingco@gmail.com`).

## Design system

- **tma-portal** - TM ANTOINE Advisory
- Primary font: **Inter**
- Dark UI with gradient headings and backdrop blur effects

## Project structure

```
app/Support/          # PHP helpers (Charts, Avatars, Cursors, etc.)
resources/views/      # Blade components and pages
public/               # CSS, JS, images, and legacy static HTML pages
design/               # Figma tokens and design metadata
```
