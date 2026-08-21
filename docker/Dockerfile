# syntax=docker/dockerfile:1.7-labs
#
# TMA-PORTAL container image.
#
#   assets  →  builds public/build/* with esbuild (Node, discarded afterwards)
#   base    →  PHP runtime + extensions + nginx + supervisor (shared)
#   deps    →  composer install, cached on the lock files alone
#   dev     →  base + dev dependencies + Xdebug (off unless asked for)
#   prod    →  base + no-dev vendor + source + built assets, non-root, cached
#
# Every stage is Linux/glibc, so what runs on a Mac is what runs on the server.


# ===========================================================================
# Stage: assets — build the CSS/JS bundles
# ===========================================================================
# Node 22 LTS. The only consumer is scripts/build-assets.mjs (esbuild 0.28,
# needs ≥18); vite 8 sits in devDependencies and would demand ≥22.12, so 22
# satisfies everything the lock file can ask for without chasing Current.
FROM node:22-bookworm-slim AS assets

WORKDIR /build

# --ignore-scripts mirrors the project's own `composer setup` recipe. It also
# stops the `playwright` dependency downloading ~400 MB of browsers, which the
# asset build has no use for.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --no-fund

# build-assets.mjs reads the load order out of the shell itself, then minifies
# each file it names. Copying these three paths (not the whole tree) keeps the
# cache tight while still invalidating whenever any bundled source changes —
# if the cache key were package.json alone, an edited stylesheet would produce
# a manifest that no longer matches the shell and AssetBundle would silently
# fall back to 133 raw tags.
COPY resources/views/pages/dashboard.html ./resources/views/pages/dashboard.html
COPY public/css ./public/css
COPY public/js ./public/js
COPY scripts/build-assets.mjs ./scripts/build-assets.mjs

RUN node scripts/build-assets.mjs


# ===========================================================================
# Stage: base — PHP runtime shared by every service
# ===========================================================================
# PHP 8.5 on Debian bookworm.
#
#   Why 8.5 and not the 8.3 composer.json advertises: composer.lock pins 17
#   Symfony v8.1.x packages that hard-require php >=8.4.1, so 8.3 cannot even
#   install. The ceiling is setasign/fpdi (<=8.5.x) and nette/* (<=8.5), so
#   the usable window is 8.4.1 ≤ PHP < 8.6 and 8.5 is the top of it.
#
#   Why Debian and not Alpine: GLOB_BRACE is unimplemented in musl and
#   app/Console/Commands/PublishDesktopRelease.php depends on it; musl's
#   iconv //TRANSLIT also changes FPDI signature-PDF output, and glibc vs musl
#   collation shifts the LOWER()/ILIKE search paths.
FROM php:8.5-fpm-bookworm AS base

# Where the app lives in every stage.
ARG APP_HOME=/var/www/html

# Match the container user to the host user so bind-mounted files stay
# writable on Linux hosts. Docker Desktop on macOS/Windows maps ownership
# for you, so the defaults are fine there.
ARG UID=1000
ARG GID=1000

ENV APP_HOME=${APP_HOME} \
    COMPOSER_ALLOW_SUPERUSER=1 \
    COMPOSER_NO_INTERACTION=1 \
    COMPOSER_HOME=/tmp/composer

# --- runtime packages -------------------------------------------------------
# nginx and supervisor live here rather than in their own containers: see the
# note in docker/nginx/templates/app.conf.template for why serving the websocket on the same
# origin is what makes Reverb work identically for PHP and for the browser.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        nginx \
        supervisor \
        ca-certificates \
        curl \
        procps \
        util-linux \
        gettext-base \
    ; \
    rm -rf /var/lib/apt/lists/*

# git and unzip serve composer only, so they are added in the stages that run
# it and left out of the production runtime — ~49 MB of tooling, and two fewer
# binaries for anyone who gets a shell in a production container.

# --- PHP extensions ---------------------------------------------------------
# Determined by auditing the code, not by habit:
#   pdo_pgsql  Postgres. composer.json declares no ext-*, so a missing driver
#              surfaces as "could not find driver" at the first query.
#   gd         AvatarService decodes uploads unguarded, and Messaging\Thumbnailer
#              calls imagecreatefromwebp — --with-webp is NOT optional.
#   zip        FolderTree does `new ZipArchive` with no extension_loaded guard,
#              so folder downloads fatal without it.
#   pcntl      queue --timeout (SIGALRM), graceful SIGTERM drain, and Reverb's
#              SignalableCommandInterface, which throws without it.
#   exif       orientation for thumbnails (guarded, but sideways photos otherwise).
#   intl       Str::transliterate in the login rate-limit key.
#   bcmath     brick/math's fast path.
#
# OPcache is deliberately absent from this list: PHP 8.5 compiles it into the
# binary statically and enables it by default, so `docker-php-ext-install
# opcache` builds nothing and fails with "cp: cannot stat 'modules/*'". Its
# settings are tuned in docker/php/app.ini instead.
#
# Deliberately absent: redis (REDIS_CLIENT=predis, pure PHP), pgsql (zero pg_*
# calls — PDO only), sockets (Reverb uses stream_socket_server), imagick
# (Thumbnailer documents that it is not installed).
# pdo_sqlite/sqlite3 ship enabled in the base image and phpunit.xml needs them.
#
# The apt-mark dance is the official php image's own recipe: compile against
# the -dev headers, then keep only the shared libraries the .so files actually
# linked against, so no runtime library is guessed at or left behind.
RUN set -eux; \
    savedAptMark="$(apt-mark showmanual)"; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        libpq-dev \
        libzip-dev \
        libpng-dev \
        libjpeg62-turbo-dev \
        libwebp-dev \
        libfreetype6-dev \
        libicu-dev \
    ; \
    docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp; \
    docker-php-ext-install -j"$(nproc)" \
        pdo_pgsql \
        gd \
        zip \
        exif \
        pcntl \
        intl \
        bcmath \
    ; \
    apt-mark auto '.*' > /dev/null; \
    apt-mark manual $savedAptMark > /dev/null; \
    ldd "$(php -r 'echo ini_get("extension_dir");')"/*.so \
        | awk '/=>/ { so = $(NF-1); if (index(so, "/usr/local/") == 1) next; gsub("^/(usr/)?", "", so); printf "*/%s\n", so }' \
        | sort -u \
        | xargs -r dpkg-query --search 2>/dev/null \
        | cut -d: -f1 \
        | sort -u \
        | xargs -r apt-mark manual > /dev/null; \
    apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
    rm -rf /var/lib/apt/lists/*; \
    \
    # Fail the build here rather than at runtime if anything did not load.
    php -m > /tmp/mods; \
    for m in pdo_pgsql gd zip exif pcntl intl bcmath Zend\ OPcache pdo_sqlite mbstring openssl curl fileinfo dom; do \
        grep -qi "^${m}$" /tmp/mods || { echo "MISSING PHP EXTENSION: $m"; cat /tmp/mods; exit 1; }; \
    done; \
    php -r 'if (!function_exists("imagecreatefromwebp")) { fwrite(STDERR, "gd built without webp\n"); exit(1); }'; \
    rm /tmp/mods

# --- composer ---------------------------------------------------------------
# The -bin image ships the phar alone. Pinned to the 2.x line so a Composer 3
# release cannot silently change resolution behaviour.
COPY --from=composer/composer:2-bin /composer /usr/bin/composer

# --- configuration ----------------------------------------------------------
COPY docker/php/app.ini            /usr/local/etc/php/conf.d/zz-tma.ini
COPY docker/php/fpm-pool.conf      /usr/local/etc/php-fpm.d/zz-tma.conf
COPY docker/nginx/nginx.conf       /etc/nginx/nginx.conf
COPY docker/nginx/conf.d/          /etc/nginx/conf.d/
# Rendered into /tmp/nginx/conf.d at container start — see docker/entrypoint.sh.
COPY docker/nginx/templates/       /etc/nginx/templates/
COPY docker/supervisor/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/entrypoint.sh          /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# Defaults for the ${...} placeholders in fpm-pool.conf. The entrypoint
# re-exports these so a compose-supplied value wins, but they must exist here
# too or `php-fpm -t` below has nothing to expand.
ENV PHP_FPM_MAX_CHILDREN=20 \
    PHP_FPM_START_SERVERS=4 \
    PHP_FPM_MIN_SPARE=2 \
    PHP_FPM_MAX_SPARE=6


# --- user and writable state -----------------------------------------------
# Everything runs as www-data — nginx included. Nothing here binds a port
# below 1024, so no part of this image needs root at runtime.
#
# The temp/pid paths are moved off the packaged /var/lib/nginx and /run so a
# non-root master can write them, and the storage subtree is pre-created
# because storage/framework/cache/data is gitignored and therefore absent
# from a clean checkout.
RUN set -eux; \
    groupmod -o -g "${GID}" www-data; \
    usermod  -o -u "${UID}" -g "${GID}" -d "${APP_HOME}" www-data; \
    mkdir -p \
        "${APP_HOME}" \
        /tmp/nginx/body /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi \
        /var/log/supervisor \
        /run/php \
        /tmp/composer \
    ; \
    rm -f /etc/nginx/sites-enabled/default; \
    chown -R www-data:www-data \
        "${APP_HOME}" /tmp/nginx /var/log/supervisor /run/php /tmp/composer /var/lib/nginx

# Fail the build, not the deploy, if either daemon's configuration is wrong.
# Runs after the directories above exist: nginx -t verifies its temp paths and
# document root, and php-fpm -t proves the ${PHP_FPM_*} placeholders expand
# (php-fpm rejects a non-numeric pm.max_children outright).
RUN set -eux; \
    mkdir -p "${APP_HOME}/public" /tmp/nginx/conf.d; \
    php-fpm -t; \
    # The vhost is a template now, so render it with the default port purely to
    # validate it. The entrypoint re-renders it for real at container start.
    TMA_NGINX_PORT=8001 envsubst '${TMA_NGINX_PORT}' \
        < /etc/nginx/templates/app.conf.template \
        > /tmp/nginx/conf.d/app.conf; \
    nginx -t; \
    rm -f /tmp/nginx/conf.d/app.conf; \
    # `nginx -t` runs as root here and leaves a root-owned nginx.pid and
    # nobody-owned temp directories behind, which the non-root runtime then
    # cannot write — nginx dies at startup with
    # `open() "/tmp/nginx/nginx.pid" failed (13: Permission denied)`.
    rm -f /tmp/nginx/nginx.pid; \
    chown -R www-data:www-data /tmp/nginx

WORKDIR ${APP_HOME}

ENTRYPOINT ["entrypoint"]


# ===========================================================================
# Stage: deps — vendor/, cached on the lock files alone
# ===========================================================================
FROM base AS deps

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git unzip; \
    rm -rf /var/lib/apt/lists/*

# --no-scripts is load-bearing, not an optimisation. composer's
# post-autoload-dump runs `artisan package:discover`, which boots
# bootstrap/app.php and therefore needs routes/ and every provider — none of
# which exist yet at this layer. Autoloading and discovery happen after the
# source lands, in the prod stage.
COPY composer.json composer.lock ./
RUN --mount=type=cache,target=/tmp/composer/cache,sharing=locked \
    composer install \
        --no-dev \
        --no-scripts \
        --no-autoloader \
        --prefer-dist \
        --no-progress

# The same tree with dev dependencies, for the dev and test stages.
FROM base AS deps-dev
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git unzip; \
    rm -rf /var/lib/apt/lists/*
COPY composer.json composer.lock ./
RUN --mount=type=cache,target=/tmp/composer/cache,sharing=locked \
    composer install \
        --no-scripts \
        --no-autoloader \
        --prefer-dist \
        --no-progress


# ===========================================================================
# Stage: dev
# ===========================================================================
# The source arrives as a bind mount at runtime, not a COPY, so this stage is
# just the runtime plus dev tooling. vendor/ is baked in and then shadowed by
# a named volume (see compose.yaml) — container-managed rather than read off
# the host, which is both correct on Linux and much faster on macOS.
FROM base AS dev

ARG APP_HOME=/var/www/html

# Xdebug is installed but inert: xdebug.mode=off costs nothing until you set
# XDEBUG_MODE=debug on the service. Installing it later would mean rebuilding
# mid-debugging-session, which is exactly when you don't want to.
# composer runs inside this image at container start (the entrypoint reinstalls
# whenever composer.lock changes), so it needs its tooling here.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git unzip; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    savedAptMark="$(apt-mark showmanual)"; \
    apt-get update; \
    # Unquoted on purpose: PHPIZE_DEPS is a whitespace-separated package list,
    # and quoting it makes apt look for one package with spaces in its name.
    apt-get install -y --no-install-recommends $PHPIZE_DEPS; \
    pecl install xdebug; \
    docker-php-ext-enable xdebug; \
    apt-mark auto '.*' > /dev/null; \
    apt-mark manual $savedAptMark > /dev/null; \
    apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
    rm -rf /var/lib/apt/lists/* /tmp/pear

COPY docker/php/dev.ini /usr/local/etc/php/conf.d/zzz-tma-dev.ini

COPY --from=deps-dev --chown=www-data:www-data ${APP_HOME}/vendor ${APP_HOME}/vendor

ENV APP_ENV=local \
    TMA_DEV=1

USER www-data

CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]


# ===========================================================================
# Stage: prod
# ===========================================================================
FROM base AS prod

ARG APP_HOME=/var/www/html

COPY --from=deps --chown=www-data:www-data ${APP_HOME}/vendor ${APP_HOME}/vendor

# These excludes trim what the image carries; they are NOT a security boundary.
# .dockerignore is what keeps .env, .git, desktop/ and *.bak out of the build
# context in the first place, and it is what must be relied on.
# The two local-disk roots are excluded here and copied to /opt/tma/seed below
# instead, so their ~45 MB of committed content exists in exactly one place in
# the image. The entrypoint restores it into the running tree.
COPY --chown=www-data:www-data \
     --exclude=docker \
     --exclude=desktop \
     --exclude=tests \
     --exclude=phpunit.xml \
     --exclude=storage/app/private \
     --exclude=storage/app/public \
     . ${APP_HOME}

COPY --chown=www-data:www-data storage/app/private /opt/tma/seed/private
COPY --chown=www-data:www-data storage/app/public  /opt/tma/seed/public

# Built bundles replace whatever public/build the context may have held.
COPY --from=assets --chown=www-data:www-data /build/public/build ${APP_HOME}/public/build

# Now that the source is present, generate the optimised autoloader and run
# package discovery. Neither needs .env, APP_KEY, a database or Redis — no
# provider touches any of them during boot().
#
# config:cache and route:cache are deliberately NOT run here. config/services.php
# bakes env('APP_URL') into the OAuth redirect URIs, which would freeze the
# callback to a build-time value; and routes/web.php registers /design/db —
# a read-only database browser — inside an app()->environment('local') guard
# that route:cache would evaluate exactly once. Both run in the entrypoint,
# after the real environment exists. view:cache is safe and runs here.
RUN set -eux; \
    composer dump-autoload --optimize --classmap-authoritative --no-dev; \
    php artisan package:discover --ansi; \
    php artisan view:cache; \
    # storage/app/private and storage/app/public must EXIST here, owned by
    # www-data. compose.prod.yaml mounts a named volume at each; Docker
    # initialises a fresh volume from whatever the image has at that path —
    # including its ownership — and creates it root-owned if the path is
    # missing. A root-owned volume is silent: the container starts, serves
    # pages, and only fails when something first tries to write an avatar.
    mkdir -p \
        storage/app/private \
        storage/app/public/avatars \
        storage/app/private/uploads \
        storage/app/private/thumbs \
        storage/app/private/tmp \
        storage/app/private/stamp \
        storage/app/call-recordings \
        storage/framework/cache/data \
        storage/framework/sessions \
        storage/framework/views \
        storage/logs \
        bootstrap/cache \
    ; \
    chown -R www-data:www-data storage bootstrap/cache; \
    chmod -R u+rwX storage bootstrap/cache

# Seed copies of the two local-disk roots.
#
# In production those roots are named volumes (see compose.prod.yaml), because
# a worker writes files the web container has to serve — sender photos,
# messaging thumbnails, generated thumbnails — and because anything written to
# a container's own writable layer is discarded on the next redeploy.
#
# But both roots also carry content committed to git: 285 vault documents that
# rows with disk='local' resolve against, plus messaging attachments and
# avatars. An empty volume mounted over them would hide every one of those.
# So the baked content is duplicated here, and the entrypoint copies anything
# missing back in after the volume is mounted.
#
# Nothing further to do: the seed arrived via its own COPY above, and the
# entrypoint copies it into place on every start — whether the target is an
# empty named volume or the image's own writable layer.

ENV APP_ENV=production \
    APP_DEBUG=false

USER www-data

EXPOSE 8001

# Follows the same variable the nginx template does, so an image published on a
# non-default port is still probed on the port it actually listens on.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${TMA_NGINX_PORT:-8001}/up" || exit 1

CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]


# ===========================================================================
# Stage: test — prod tree plus dev dependencies, for CI
# ===========================================================================
# Not referenced by either compose file; built explicitly:
#   docker build -f docker/Dockerfile --target test -t tma-portal:test .
# phpunit.xml runs against sqlite :memory:, so this needs no services at all.
FROM prod AS test

USER root

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git unzip; \
    rm -rf /var/lib/apt/lists/*

COPY --from=deps-dev --chown=www-data:www-data ${APP_HOME}/vendor ${APP_HOME}/vendor

# Added back here rather than shipped in the production image.
COPY --chown=www-data:www-data tests ${APP_HOME}/tests
COPY --chown=www-data:www-data phpunit.xml ${APP_HOME}/phpunit.xml

# Laravel expects a .env at the base path and the suite reads it directly; the
# production image deliberately has none, because its configuration comes from
# the environment. Without one, every test emits
# "file_get_contents(/var/www/html/.env): Failed to open stream" and PHPUnit
# reports the whole run as risky.
#
# The feature flags are forced on because tests/Feature/PortalAccessTest asserts
# that an administrator holds *every* capability, and the cbi.* capabilities
# only exist when FEATURE_CBI is set — which is how the suite is run on a
# developer machine today. phpunit.xml still pins the database to sqlite
# :memory:, so this never reaches Postgres.
COPY --chown=www-data:www-data .env.docker.example ${APP_HOME}/.env
RUN set -eux; \
    printf '\nFEATURE_CBI=true\nFEATURE_CIP=true\n' >> ${APP_HOME}/.env; \
    chown www-data:www-data ${APP_HOME}/.env; \
    composer dump-autoload --optimize

USER www-data

ENV APP_ENV=testing
CMD ["php", "artisan", "test"]
