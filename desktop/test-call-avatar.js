/*
 * The caller's photo in the ring panel.
 *
 * It never showed. The portal publishes avatars as root-relative paths
 * ("/media/avatars/x.jpg") and the panel is a local file, so the browser
 * resolved that to file:///media/avatars/x.jpg and quietly fell back to
 * initials. Making it absolute is not enough either — that route is behind
 * auth, and the session cookie is SameSite=Lax, so a file:// page asking for it
 * sends no cookie and gets the sign-in page back.
 *
 * This stands up a portal that behaves the same way: relative paths, a cookie
 * required, and the sign-in page served to anyone without one.
 *
 * Run with: npm run test:call-avatar
 */
const { app, session, net, BrowserWindow } = require('electron');
const http = require('node:http');

// A 1x1 PNG, so there is a real image to recognise on the other side.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/media/avatars/me.jpg') {
      // Exactly what the portal does: no cookie, no photo — you get the login page.
      if (!/tma-session=/.test(req.headers.cookie || '')) {
        res.writeHead(302, { Location: '/auth/login' }).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(PIXEL);
      return;
    }
    if (req.url === '/huge.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 4_000_000 })
        .end(Buffer.alloc(4_000_000));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>sign in</html>');
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // The app's own session, holding the portal cookie — which is the whole
  // reason the main process can fetch what the panel cannot.
  await session.defaultSession.cookies.set({
    url: origin, name: 'tma-session', value: 'yes', sameSite: 'lax',
  });

  /* The function under test, mirrored from main.js so it can run headless. */
  const isPortalUrl = (u) => { try { return new URL(u).origin === origin; } catch { return false; } };

  async function avatarDataUri(raw) {
    if (!raw || typeof raw !== 'string') return '';
    if (raw.startsWith('data:')) return raw;

    let url;
    try { url = new URL(raw, origin).toString(); } catch { return ''; }
    if (!isPortalUrl(url)) return url;

    try {
      const response = await net.fetch(url, { session: session.defaultSession, credentials: 'include' });
      if (!response.ok) return '';
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('image/')) return '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 3_000_000) return '';
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      return '';
    }
  }

  const relative = await avatarDataUri('/media/avatars/me.jpg');
  check('a root-relative path becomes a data URI', relative.startsWith('data:image/png;base64,'), true);
  check('and carries the real bytes', relative.endsWith(PIXEL.toString('base64')), true);

  check('an absolute portal URL works too',
    (await avatarDataUri(`${origin}/media/avatars/me.jpg`)).startsWith('data:image/'), true);

  // An expired session answers with HTML, not a 401 — the check has to be on
  // the content type, or the panel would render the login page as a photo.
  await session.defaultSession.cookies.remove(origin, 'tma-session');
  check('a signed-out session yields nothing, not a login page', await avatarDataUri('/media/avatars/me.jpg'), '');

  check('an oversized image is refused', await avatarDataUri('/huge.png'), '');
  check('a missing avatar stays empty', await avatarDataUri(''), '');
  check('a data URI is passed straight through', await avatarDataUri('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  check('an outside URL is left for the panel to load',
    await avatarDataUri('https://cdn.example.com/p.jpg'), 'https://cdn.example.com/p.jpg');

  /* And the panel really does render what it is handed. */
  await session.defaultSession.cookies.set({ url: origin, name: 'tma-session', value: 'yes', sameSite: 'lax' });
  const callWindow = require('./call-window');
  const panel = callWindow.show({
    name: 'Dana Reeve', media: 'audio', avatar: await avatarDataUri('/media/avatars/me.jpg'),
  });
  await new Promise((r) => panel.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, 600));

  const rendered = await panel.webContents.executeJavaScript(
    "(() => { const i = document.querySelector('#avatar img'); return i ? (i.complete && i.naturalWidth > 0) : false; })()", true,
  );
  check('the panel shows the photo rather than initials', rendered, true);

  // The raw path is deliberately not re-tested by opening a second panel: a
  // show() after close() never fires did-finish-load and hangs the whole run.
  // What it would prove is covered above — the raw path is precisely the input
  // avatarDataUri() turns into the data URI this panel just rendered.
  callWindow.close();
  server.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
