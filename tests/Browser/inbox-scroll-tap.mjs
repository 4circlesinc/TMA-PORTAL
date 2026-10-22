/**
 * Mobile inbox rows: a vertical scroll must not open the row as a tap.
 *
 * Messages / Email row swipes used to set moved only from |dx|, so a finger
 * scroll left moved=false and pointerup opened the item under the thumb.
 * This fixture mirrors the production axis gate (DEAD_ZONE / AXIS_RATIO) and
 * asserts scroll vs tap vs swipe outcomes with pointer events.
 *
 *   node tests/Browser/inbox-scroll-tap.mjs
 *   TMA_BROWSER=webkit node tests/Browser/inbox-scroll-tap.mjs
 */
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; height: 100%; font: 14px/1.4 system-ui, sans-serif; }
    .list { height: 100vh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    .row-swipe { position: relative; height: 72px; border-bottom: 1px solid #ddd; touch-action: pan-y; }
    .row-swipe-track { height: 100%; display: flex; align-items: center; padding: 0 16px; background: #fff; }
    .row { width: 100%; border: 0; background: transparent; text-align: left; font: inherit; padding: 0; }
  </style>
</head>
<body>
  <div class="list" data-list>
    ${Array.from({ length: 20 }, (_, i) => `
      <div class="row-swipe" data-row-swipe="${i + 1}">
        <div class="row-swipe-track" data-row-swipe-track>
          <button type="button" class="row" data-row="${i + 1}">Contact ${i + 1}</button>
        </div>
      </div>`).join('')}
  </div>
  <script>
    window.__opened = [];
    (function () {
      // Keep in sync with bindMessagesInboxSwipes / bindEmailRowSwipes.
      var DEAD_ZONE = 8;
      var AXIS_RATIO = 1.3;

      document.querySelectorAll('[data-row-swipe]').forEach(function (wrap) {
        var track = wrap.querySelector('[data-row-swipe-track]');
        var btn = wrap.querySelector('[data-row]');
        var startX = 0, startY = 0, dragging = false, moved = false;

        function openRow() {
          window.__opened.push(wrap.getAttribute('data-row-swipe'));
        }

        track.addEventListener('pointerdown', function (e) {
          if (e.button !== 0) return;
          dragging = true;
          moved = false;
          startX = e.clientX;
          startY = e.clientY;
          delete wrap.dataset.swipeMoved;
          try { track.setPointerCapture(e.pointerId); } catch (_) {}
        });

        track.addEventListener('pointermove', function (e) {
          if (!dragging) return;
          var dx = e.clientX - startX;
          var dy = e.clientY - startY;
          if (!moved) {
            if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
            if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) {
              dragging = false;
              try {
                if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
              } catch (_) {}
              wrap.dataset.swipeMoved = '1';
              return;
            }
            moved = true;
          }
          e.preventDefault();
          track.style.transform = 'translateX(' + dx + 'px)';
        }, { passive: false });

        function endDrag(e) {
          if (!dragging) return;
          dragging = false;
          try {
            if (e && track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
          } catch (_) {}
          track.style.transform = '';
          if (moved) {
            wrap.dataset.swipeMoved = '1';
            requestAnimationFrame(function () { delete wrap.dataset.swipeMoved; });
            return;
          }
          wrap.dataset.tapHandled = '1';
          requestAnimationFrame(function () { delete wrap.dataset.tapHandled; });
          openRow();
        }

        track.addEventListener('pointerup', endDrag);
        track.addEventListener('pointercancel', endDrag);

        btn.addEventListener('click', function () {
          if (wrap.dataset.tapHandled || wrap.dataset.swipeMoved) return;
          openRow();
        });
      });
    })();
  </script>
</body>
</html>`;

const failures = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
};

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const engine = process.env.TMA_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

async function opened() {
  return page.evaluate(() => window.__opened.slice());
}

async function clearOpened() {
  await page.evaluate(() => {
    window.__opened = [];
  });
}

/** Dispatch pointerdown → moves → pointerup → click on the track under from. */
async function pointerGesture(from, to, steps = 12) {
  await page.evaluate(
    ({ from, to, steps }) => {
      const el = document.elementFromPoint(from.x, from.y);
      const track = el && el.closest('[data-row-swipe-track]');
      if (!track) throw new Error('no track at ' + from.x + ',' + from.y);
      const id = 41;
      const fire = (type, x, y, buttons) => {
        track.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: id,
            pointerType: 'touch',
            button: 0,
            buttons,
          })
        );
      };
      fire('pointerdown', from.x, from.y, 1);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        fire('pointermove', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1);
      }
      fire('pointerup', to.x, to.y, 0);
      const btn = track.querySelector('[data-row]');
      (btn || track).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: to.x, clientY: to.y, button: 0 })
      );
    },
    { from, to, steps }
  );
}

try {
  await page.goto(url, { waitUntil: 'networkidle' });

  const box = await page.$eval('[data-row-swipe="1"] [data-row-swipe-track]', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  console.log('Inbox scroll-vs-tap fixture @ 390×844');

  await clearOpened();
  await pointerGesture(box, { x: box.x + 2, y: box.y + 2 }, 2);
  let got = await opened();
  check(got.length === 1 && got[0] === '1', `a near-stationary tap opens the row (got ${JSON.stringify(got)})`);

  await clearOpened();
  await pointerGesture(box, { x: box.x + 4, y: box.y + 120 }, 16);
  got = await opened();
  check(got.length === 0, `a vertical scroll does not open (got ${JSON.stringify(got)})`);

  await clearOpened();
  await pointerGesture(box, { x: box.x + 1, y: box.y + 1 }, 2);
  got = await opened();
  check(got.length === 1 && got[0] === '1', `a tap after a scroll still opens (got ${JSON.stringify(got)})`);

  await clearOpened();
  await pointerGesture(box, { x: box.x + 80, y: box.y + 2 }, 16);
  got = await opened();
  check(got.length === 0, `a horizontal swipe does not open as a tap (got ${JSON.stringify(got)})`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error('\nFAILED:');
  failures.forEach((f) => console.error(' - ' + f));
  process.exit(1);
}

console.log('\nAll checks passed.');
