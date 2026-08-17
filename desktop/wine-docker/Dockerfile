# Native arm64 container: Box64 emulates the x86_64 Wine build, using native
# ARM system libraries. Avoids Rosetta entirely (it can't handle Wine's
# segment-selector and signal-frame manipulation; QEMU-via-Docker needs a
# global Docker Desktop settings change).
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget xz-utils ca-certificates gnupg \
    xvfb x11vnc fluxbox novnc websockify \
    fonts-liberation fonts-dejavu-core \
    libgl1 libegl1 libgles2 libgl1-mesa-dri libvulkan1 mesa-vulkan-drivers \
    scrot procps winbind \
 && rm -rf /var/lib/apt/lists/*

RUN wget -qO- https://ryanfortner.github.io/box64-debs/KEY.gpg | gpg --dearmor -o /usr/share/keyrings/box64-archive-keyring.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/box64-archive-keyring.gpg] https://ryanfortner.github.io/box64-debs/debian ./" > /etc/apt/sources.list.d/box64.list \
 && apt-get update \
 && (apt-get install -y box64-generic-arm || apt-get install -y box64) \
 && rm -rf /var/lib/apt/lists/*

ARG WINE_URL=https://github.com/Kron4ek/Wine-Builds/releases/download/11.15/wine-11.15-amd64-wow64.tar.xz
RUN wget -q -O /tmp/wine.tar.xz "$WINE_URL" \
 && mkdir -p /opt/wine \
 && tar -xJf /tmp/wine.tar.xz -C /opt/wine --strip-components=1 \
 && rm /tmp/wine.tar.xz

# box64 intercepts execve of x86_64 binaries itself, so wrappers are only
# needed for the entry points we call from the shell
RUN printf '#!/bin/sh\nexec box64 /opt/wine/bin/wine "$@"\n' > /usr/local/bin/wine \
 && printf '#!/bin/sh\nexec box64 /opt/wine/bin/wineserver "$@"\n' > /usr/local/bin/wineserver \
 && chmod +x /usr/local/bin/wine /usr/local/bin/wineserver

ENV DISPLAY=:0 \
    WINEPREFIX=/root/.wine \
    WINEARCH=win64 \
    WINEDEBUG=fixme-all \
    WINEDLLOVERRIDES="mscoree=d;mshtml=d" \
    BOX64_NOBANNER=1 \
    APP_EXE="/app/TM ANTOINE Portal.exe"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
