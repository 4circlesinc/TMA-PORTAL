#!/bin/sh
# TMA-PORTAL container entrypoint.
#
# Runs before every role (app, queue, scheduler, reverb, migrate, artisan …),
# does only what is safe to repeat, then execs the command it was given.
#
# Deliberately NOT here:
#   artisan key:generate  — ConnectedAccount.token uses the `encrypted` cast.
#                           A new APP_KEY makes every stored Microsoft/Google
#                           OAuth token permanently undecryptable. The key is
#                           supplied by the environment, never generated.
#   artisan migrate       — owned by the one-shot `migrate` service, so that
#                           N app replicas cannot race the schema.

set -eu

log()  { printf '[entrypoint] %s\n' "$*" >&2; }
fail() { printf '[entrypoint] ERROR: %s\n' "$*" >&2; exit 1; }

APP_HOME="${APP_HOME:-/var/www/html}"
cd "$APP_HOME"

# ---------------------------------------------------------------------------
# php-fpm pool sizing. Exported so the ${...} placeholders in
# docker/php/fpm-pool.conf resolve; harmless for the non-fpm roles.
# ---------------------------------------------------------------------------
export PHP_FPM_MAX_CHILDREN="${PHP_FPM_MAX_CHILDREN:-20}"
export PHP_FPM_START_SERVERS="${PHP_FPM_START_SERVERS:-4}"
export PHP_FPM_MIN_SPARE="${PHP_FPM_MIN_SPARE:-2}"
export PHP_FPM_MAX_SPARE="${PHP_FPM_MAX_SPARE:-6}"

# ---------------------------------------------------------------------------
# Refuse to start production with the shared development key.
#
# .env.docker.example ships a real, working APP_KEY so that `docker compose up`
# succeeds on a fresh clone. That key is in version control and therefore
# public. This is the guard that stops it reaching a production container.
# ---------------------------------------------------------------------------
DEV_KEY='base64:Yk5nQ0RlVjBja1hUM3BSNVdmMkxxSmg4dEF6TnhFNmM='

if [ "${APP_ENV:-}" = "production" ]; then
    [ "${APP_KEY:-}" = "$DEV_KEY" ] && fail "APP_KEY is the public development key from .env.docker.example. Supply the real production key (and APP_PREVIOUS_KEYS) before starting in production."
    [ -z "${APP_KEY:-}" ] && fail "APP_KEY is empty."
    case "${APP_DEBUG:-false}" in
        true|1|on|On|TRUE) fail "APP_DEBUG is enabled with APP_ENV=production." ;;
    esac
fi

# ---------------------------------------------------------------------------
# nginx configuration.
#
# Rendered here rather than baked, so the listen port can follow the port the
# stack is published on. Only TMA_NGINX_PORT is substituted — naming it
# explicitly stops envsubst from eating nginx's own $uri, $host and friends.
# ---------------------------------------------------------------------------
export TMA_NGINX_PORT="${TMA_NGINX_PORT:-8001}"

if [ -d /etc/nginx/templates ]; then
    mkdir -p /tmp/nginx/conf.d
    for tpl in /etc/nginx/templates/*.template; do
        [ -e "$tpl" ] || continue
        out="/tmp/nginx/conf.d/$(basename "$tpl" .template)"
        envsubst '${TMA_NGINX_PORT}' < "$tpl" > "$out"
    done
fi

# ---------------------------------------------------------------------------
# Writable state.
#
# Volumes mount at leaf directories only — never at storage/ or
# storage/app/private, which would mask the 285 committed documents under
# storage/app/private/vault that every files row with disk='local' resolves
# against. A fresh named volume also arrives empty and root-owned on some
# engines, so ownership is asserted here rather than assumed from the image.
# ---------------------------------------------------------------------------
for dir in \
    storage/app/private/uploads \
    storage/app/private/thumbs \
    storage/app/private/tmp \
    storage/app/private/stamp \
    storage/app/public/avatars \
    storage/app/call-recordings \
    storage/framework/cache/data \
    storage/framework/sessions \
    storage/framework/views \
    storage/logs \
    bootstrap/cache
do
    mkdir -p "$dir" 2>/dev/null || true
    [ -w "$dir" ] || log "WARNING: $dir is not writable by $(id -un)"
done

# config/logging.php pins the emergency logger to storage/logs/laravel.log
# regardless of LOG_CHANNEL, so this file must exist and be writable even
# though everything else goes to stderr.
touch storage/logs/laravel.log 2>/dev/null || true

# ---------------------------------------------------------------------------
# Development: keep vendor/ in step with composer.lock.
#
# vendor/ is baked into the image and then shadowed by a named volume, which
# Docker seeds from the image the first time it is created and never again.
# Without this, a `composer require` on the host would leave every container
# running the dependency set from whenever that volume was born.
#
# The lock file lives inside the vendor volume, not in /tmp: /tmp is private to
# each container, so a lock there would serialise nothing and all five services
# would run composer into the same shared directory at once.
# ---------------------------------------------------------------------------
if [ "${TMA_DEV:-0}" = "1" ] && [ -f composer.lock ]; then
    (
        flock 9
        want="$(md5sum composer.lock | cut -d' ' -f1)"
        have="$(cat vendor/.tma-lock-hash 2>/dev/null || echo none)"

        if [ ! -f vendor/autoload.php ] || [ "$want" != "$have" ]; then
            log "composer.lock changed (or vendor/ is empty) — installing dependencies…"
            composer install --no-interaction --prefer-dist --no-progress
            printf '%s\n' "$want" > vendor/.tma-lock-hash
        fi
    ) 9>vendor/.tma-install.lock
fi

# ---------------------------------------------------------------------------
# Wait for Postgres.
#
# depends_on: service_healthy already gates this, but pg_isready reports the
# server is accepting connections a moment before it will accept *this* role,
# and the image is also expected to run outside compose. Bounded retries with
# a real connection attempt — never a fixed sleep.
#
# This matters more than it looks: SESSION_DRIVER=database plus the
# ApplySecurityPolicyHeaders middleware (which reads portal_settings on every
# response) means the container cannot serve even the login page until
# Postgres answers.
# ---------------------------------------------------------------------------
wait_for_db() {
    [ "${DB_CONNECTION:-}" = "pgsql" ] || return 0
    [ "${TMA_SKIP_DB_WAIT:-0}" = "1" ] && return 0

    attempts="${TMA_DB_WAIT_ATTEMPTS:-60}"
    i=1
    while [ "$i" -le "$attempts" ]; do
        if php -r '
            $dsn = sprintf("pgsql:host=%s;port=%s;dbname=%s",
                getenv("DB_HOST") ?: "127.0.0.1",
                getenv("DB_PORT") ?: "5432",
                getenv("DB_DATABASE") ?: "");
            if (($m = getenv("DB_SSLMODE")) !== false && $m !== "") { $dsn .= ";sslmode=" . $m; }
            try {
                new PDO($dsn, getenv("DB_USERNAME") ?: "", getenv("DB_PASSWORD") ?: "",
                    [PDO::ATTR_TIMEOUT => 3, PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            } catch (Throwable $e) { exit(1); }
        ' 2>/dev/null; then
            [ "$i" -gt 1 ] && log "database reachable after ${i} attempt(s)"
            return 0
        fi
        [ "$i" = 1 ] && log "waiting for postgres at ${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}…"
        i=$((i + 1))
        sleep 1
    done

    fail "database at ${DB_HOST:-127.0.0.1}:${DB_PORT:-5432} did not become reachable after ${attempts} attempt(s)"
}

# ---------------------------------------------------------------------------
# public/storage.
#
# The host's symlink is an absolute path into /Users/... and is excluded from
# the build context, so it must be recreated here. Nothing currently serves
# through it — every asset streams via a controller — but it costs one
# idempotent call and keeps legacy photo_url LIKE '/storage/%' rows resolving.
# ---------------------------------------------------------------------------
link_storage() {
    [ -L public/storage ] && return 0
    [ -e public/storage ] && return 0
    php artisan storage:link --quiet 2>/dev/null || log "storage:link skipped"
}

# ---------------------------------------------------------------------------
# Production caches.
#
# Built here, not in the Dockerfile, because both bake environment-dependent
# values that must not be frozen at image-build time:
#   config:cache → config/services.php resolves env('APP_URL') into the Google
#                  and Microsoft OAuth redirect URIs.
#   route:cache  → routes/web.php registers /design/db (a read-only database
#                  browser), /design/auth and /demo/avatars inside an
#                  app()->environment('local') guard, which route:cache
#                  evaluates exactly once.
# ---------------------------------------------------------------------------
optimize() {
    [ "${APP_ENV:-}" = "production" ] || return 0
    [ "${TMA_SKIP_OPTIMIZE:-0}" = "1" ] && return 0

    log "caching config, routes and views for production…"
    php artisan config:cache --quiet
    php artisan route:cache --quiet
    php artisan view:cache --quiet
    php artisan event:cache --quiet 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
role="${1:-}"

case "$role" in
    supervisord)
        wait_for_db
        link_storage
        optimize
        log "starting web (nginx + php-fpm) on :${TMA_NGINX_PORT}"
        ;;
    php)
        # artisan queue:work / schedule:work / reverb:start / migrate / tinker …
        wait_for_db
        case "${2:-} ${3:-}" in
            *migrate*) log "running migrations" ;;
            *) optimize ;;
        esac
        ;;
    *)
        : # composer, sh, npm, anything else: no ceremony
        ;;
esac

exec "$@"
