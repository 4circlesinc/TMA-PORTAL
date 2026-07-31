'use strict';

/**
 * afterPack hook: give the bundle a real ad-hoc signature.
 *
 * With `hardenedRuntime: true` and no Developer ID certificate in the keychain,
 * electron-builder skips signing altogether. What ships then is the bundle as
 * the linker left it: `Sealed Resources=none`, `Info.plist=not bound`. That is
 * not merely "unsigned" — it is a *broken* signature, and macOS reports it the
 * harshest way it has: "TM ANTOINE Portal is damaged and can't be opened. You
 * should move it to the Trash." Which reads to everyone who downloads it as a
 * corrupt download rather than a missing certificate.
 *
 * Signing ad-hoc (`--sign -`) seals the resources and binds the Info.plist, so
 * the bundle verifies. Gatekeeper still blocks it on first launch, because
 * ad-hoc carries no identity to trust — but it blocks with the ordinary,
 * bypassable "Apple cannot check it for malicious software", which right-click
 * → Open clears for good. See README "Distribution & Gatekeeper".
 *
 * This is a floor, not a fix. The fix is a Developer ID Application cert plus
 * notarization; set CSC_LINK/CSC_NAME and this hook steps aside, because
 * electron-builder then signs properly a moment later (afterPack runs first).
 *
 * Nested code is signed innermost-first, the order codesign requires.
 *
 * Deliberately NOT passed here: `--options runtime`. Hardened runtime turns on
 * library validation, which demands every loaded library share the main
 * process's Team ID — and an ad-hoc signature has no Team ID to share. The app
 * then dies in dyld before it draws anything:
 *
 *   Library not loaded: @rpath/Electron Framework.framework/Electron Framework
 *   … mapping process and mapped file (non-platform) have different Team IDs
 *
 * which macOS reports as "cannot be opened because of a problem". Note that
 * `codesign --verify --deep --strict` passes on such a build — the signature is
 * genuinely valid, it is the load policy that rejects it — so verification
 * alone cannot catch this. Hence the explicit flag check at the end.
 *
 * Entitlements are omitted for the same reason: outside the sandbox and the
 * hardened runtime they do nothing. Camera and microphone prompts come from the
 * NSCameraUsageDescription / NSMicrophoneUsageDescription keys that
 * `mac.extendInfo` already writes into Info.plist. `entitlements.mac.plist`
 * still applies to real Developer ID builds, which electron-builder signs.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function sign(target) {
  execFileSync('codesign', [
    '--force',
    '--sign', '-',
    '--timestamp=none',
    target,
  ], { stdio: 'inherit' });
}

/** Helper .app bundles and frameworks, deepest path first. */
function nestedBundles(root) {
  const found = [];

  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);

      if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) {
        found.push(full);
      }
      // Symlinked Versions/Current would sign the same code twice.
      if (!entry.isSymbolicLink()) walk(full);
    }
  })(root);

  return found.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('  • adhoc-sign  skipped — a signing identity is configured');
    return;
  }

  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  if (!fs.existsSync(app)) {
    throw new Error(`adhoc-sign: no bundle at ${app}`);
  }

  console.log('  • adhoc-sign  no Developer ID found, signing ad-hoc');

  for (const bundle of nestedBundles(app)) {
    sign(bundle);
  }
  sign(app);

  // A bundle that does not verify here would ship as "damaged" again, which is
  // the whole failure this hook exists to prevent. Fail the build instead.
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });

  // …and verification is not enough on its own: a hardened-runtime ad-hoc build
  // verifies cleanly and still cannot load its own Electron framework. Assert
  // the flag is absent rather than trusting that nobody re-adds it.
  // codesign -d reports on stderr, so spawnSync rather than execFileSync.
  const shown = spawnSync('codesign', ['-d', '--verbose=2', app], { encoding: 'utf8' });
  const described = `${shown.stdout || ''}${shown.stderr || ''}`;

  if (/flags=[^\s]*runtime/.test(described)) {
    throw new Error(
      'adhoc-sign: hardened runtime is set on an ad-hoc signature — the app ' +
      'will crash at launch with a Team ID mismatch. Drop `--options runtime`.'
    );
  }

  console.log('  • adhoc-sign  signature verified, library validation off');
};
