'use strict';

/*
 * Signs the Mac App Store build with the certificate its provisioning profile
 * names (mas.sign in electron-builder.mas.cjs).
 *
 * electron-builder picks the first "Apple Distribution" identity in the
 * keychain. With two of them (Xcode makes its own), which one comes first
 * changes, and App Store Connect refuses an upload signed with a certificate
 * the embedded profile does not list. Naming the certificate in mas.identity
 * is no way out: the same setting is used to find the installer certificate,
 * and the two can share nothing to match on. So the identity is swapped here,
 * after electron-builder has chosen, and signing is otherwise its own.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { sign: electronBuilderSign } = require('app-builder-lib/out/codeSign/macCodeSign');

/** SHA-1s of the certificates a decoded profile lists, uppercase hex. */
function certificatesIn(profileXml) {
  const block = profileXml.match(/<key>DeveloperCertificates<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!block) return [];
  return [...block[1].matchAll(/<data>([\s\S]*?)<\/data>/g)].map((match) =>
    crypto.createHash('sha1').update(Buffer.from(match[1].replace(/\s+/g, ''), 'base64')).digest('hex').toUpperCase());
}

function profileCertificates(profilePath) {
  return certificatesIn(execFileSync('security', ['cms', '-D', '-i', profilePath], { encoding: 'utf8' }));
}

function keychainIdentities() {
  const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  return [...out.matchAll(/\b([0-9A-F]{40})\b/g)].map((match) => match[1]);
}

/** The identity to sign with: the chosen one if the profile lists it, else one it does. */
function identityFor(chosen, wanted, available) {
  if (wanted.length === 0 || wanted.includes(String(chosen || '').toUpperCase())) return chosen;
  return wanted.find((hash) => available.includes(hash)) || null;
}

async function sign(opts) {
  if (opts.provisioningProfile && opts.identity) {
    const wanted = profileCertificates(opts.provisioningProfile);
    const identity = identityFor(opts.identity, wanted, keychainIdentities());
    if (!identity) {
      throw new Error(`mas-sign: no certificate in ${opts.provisioningProfile} is in the keychain. `
        + 'Install the Apple Distribution certificate the profile was made with, or make the profile with one you have.');
    }
    if (identity !== opts.identity) {
      console.log(`  • mas-sign  signing with ${identity.slice(0, 8)}…, the certificate the provisioning profile lists`);
      opts = { ...opts, identity };
    }
  }
  return electronBuilderSign(opts);
}

module.exports = { sign, certificatesIn, identityFor };
