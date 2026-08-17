# Run the Windows build in Docker (on a Mac)

Smoke-tests the Windows .exe without a Windows machine: an arm64 container
runs the x86_64 Wine build through Box64, draws to a virtual display, and
serves it to the browser over noVNC.

```sh
docker build -t tma-wine:box64 desktop/wine-docker
docker run -d --name tma-portal-wine --shm-size=1g -p 8080:8080 \
  -v "$PWD/desktop/release/win-unpacked:/app:ro" tma-wine:box64
open http://localhost:8080/vnc.html
```

First boot initializes the Wine prefix (about a minute), then launches the
app; app output lands in `/tmp/app.log` inside the container. Mount
`win-unpacked` (a current one — 0.8.24's shipped windowless), not a Setup
installer.

Hard-won constraints, in case anyone "simplifies" this:

- **The container must be arm64 + Box64, not `--platform linux/amd64`.**
  Rosetta cannot run Wine: Wine dispatches Windows exceptions by rewriting
  Unix signal frames and juggling segment selectors, and Rosetta aborts on
  both (`x86_avx_state_ptr` assertion on Wine 11, `invalid gdt selector` on
  Wine 9). Chromium raises such exceptions routinely, so the main process
  dies before the window exists.
- **Wine must be a modern wow64 build** (Kron4ek 11.15 here). Debian's Wine 8
  crashes Electron's Chromium outright, and non-wow64 builds ship a 32-bit
  `wine` binary that no emulator here can run.
- **The Mesa packages are load-bearing.** Chromium's *software* renderer
  still initializes through EGL/Vulkan (lavapipe); without them the app runs
  but the window stays black.
- `WINEDLLOVERRIDES="mscoree=d;mshtml=d"` skips the Wine Mono download
  prompt, which otherwise blocks prefix init forever on a modal dialog.

This is a smoke-test rig, not a fidelity substitute for real Windows:
rendering is software, there is no sound, remote fonts log NOTREACHED spam,
and installer/tray/auto-update behavior still needs a real Windows VM.
