/*
 * URLs the shell is willing to hand to the system browser.
 *
 * Email bodies are attacker-controlled, so the renderer must not be able to
 * open file:, javascript:, or anything else the OS would treat as a local
 * action. http(s) plus mailto/tel are the schemes a clicked mail link needs.
 */

function safeExternalUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192) return null;
  if (/[\u0000-\u001F]/.test(raw)) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:' && protocol !== 'tel:') {
    return null;
  }
  return parsed.href;
}

module.exports = { safeExternalUrl };
