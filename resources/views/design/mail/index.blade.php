<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  {{-- The templates reference images with root-relative paths (images/...);
       the gallery is served at /design/mail, so a base href makes them resolve
       from the site root. In-page nav uses JS scrolling, not #fragments, so
       this doesn't hijack the sidebar links. --}}
  <base href="{{ url('/') }}/">
  <title>Email postcards · TM ANTOINE Advisory</title>

  {{-- Load the same tokens + component styles the portal uses, so the
       templates render pixel-identically to /email/templates. --}}
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="{{ url('/css/tokens.css') }}">
  <link rel="stylesheet" href="{{ url('/css/theme.css') }}">
  <link rel="stylesheet" href="{{ url('/css/components.css') }}">
  <link rel="stylesheet" href="{{ url('/css/dashboard.css') }}?v=83">

  <style>
    :root { --gal-line: #e6e8ec; --gal-ink: #0f1115; --gal-muted: #6b7280; --gal-accent: #136da0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--gal-ink); background: #f6f7f9; }
    .gal { display: grid; grid-template-columns: 264px 1fr; min-height: 100vh; }

    .gal__side { border-right: 1px solid var(--gal-line); background: #fff; height: 100vh; position: sticky; top: 0; overflow-y: auto; padding: 20px 0; }
    .gal__head { padding: 0 20px 16px; border-bottom: 1px solid var(--gal-line); margin-bottom: 8px; }
    .gal__title { font-size: 15px; font-weight: 700; margin: 0; }
    .gal__sub { font-size: 12px; color: var(--gal-muted); margin: 4px 0 0; line-height: 17px; }
    .gal__grp-label { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; font-weight: 700; color: var(--gal-muted); padding: 14px 20px 6px; }
    .gal__link { display: block; padding: 8px 20px; font-size: 13.5px; color: #374151; text-decoration: none; border-left: 3px solid transparent; cursor: pointer; }
    .gal__link:hover { background: #f9fafb; }
    .gal__link.is-active { background: #eaf3f8; border-left-color: var(--gal-accent); color: var(--gal-accent); font-weight: 600; }

    .gal__main { padding: 28px 32px 120px; }
    .gal__item { margin: 0 0 44px; scroll-margin-top: 20px; }
    .gal__bar { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 2px; }
    .gal__name { font-size: 18px; font-weight: 700; margin: 0; }
    .gal__badge { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--gal-accent); background: #eaf3f8; padding: 3px 8px; border-radius: 999px; }
    .gal__subject { font-size: 13px; color: var(--gal-muted); margin: 2px 0 12px; }
    .gal__subject b { color: #374151; font-weight: 600; }
    .gal__viewport { display: inline-flex; gap: 4px; margin: 0 0 12px; }
    .gal__vp-btn { font: inherit; font-size: 12px; font-weight: 600; padding: 5px 12px; border: 1px solid var(--gal-line); background: #fff; color: var(--gal-muted); border-radius: 8px; cursor: pointer; }
    .gal__vp-btn.is-active { background: var(--gal-accent); border-color: var(--gal-accent); color: #fff; }
    .gal__stage { border: 1px solid var(--gal-line); border-radius: 14px; overflow: hidden; background: #fff; }
    .gal__stage--mobile { display: flex; justify-content: center; padding: 24px; background: #eef0f3; }
    .gal__phone { width: 390px; max-width: 100%; height: 720px; border: 0; border-radius: 22px; background: #fff; box-shadow: 0 6px 30px rgba(15, 17, 21, .14); }

    @media (max-width: 860px) { .gal { grid-template-columns: 1fr; } .gal__side { position: static; height: auto; } }
  </style>
</head>
<body>
  <div class="gal">
    <aside class="gal__side">
      <div class="gal__head">
        <p class="gal__title">Email postcards</p>
        <p class="gal__sub">Every template from <b>/email/templates</b>, rendered for review. These are the real designs — approve them and we wire them to real sends.</p>
      </div>
      <nav id="gal-nav"></nav>
    </aside>
    <main class="gal__main" id="gal-main"></main>
  </div>

  <script src="{{ url('/js/email-templates.js') }}"></script>
  <script>
    (function () {
      var T = window.TMAEmailTemplates;
      var nav = document.getElementById('gal-nav');
      var main = document.getElementById('gal-main');
      if (!T) { main.innerHTML = '<p>Templates failed to load.</p>'; return; }

      // Rebuild the current page's <head> (base + stylesheets) so the mobile
      // iframe renders the same email with the same styles — a genuinely
      // responsive preview, not a separate mobile design.
      var HEAD = (function () {
        var base = document.querySelector('base');
        var parts = base ? '<base href="' + base.href + '">' : '';
        Array.prototype.forEach.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) {
          parts += '<link rel="stylesheet" href="' + l.href + '">';
        });
        return parts;
      })();
      function mobileDoc(bodyHtml) {
        return '<!doctype html><html><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">' + HEAD +
          '<style>html,body{margin:0;background:#f6f7f9}</style></head><body>' + bodyHtml + '</body></html>';
      }

      var list = T.list();
      var groups = [];
      var byCat = {};
      list.forEach(function (t) {
        if (!byCat[t.category]) { byCat[t.category] = []; groups.push(t.category); }
        byCat[t.category].push(t);
      });

      groups.forEach(function (cat) {
        var lbl = document.createElement('div');
        lbl.className = 'gal__grp-label';
        lbl.textContent = cat;
        nav.appendChild(lbl);

        byCat[cat].forEach(function (t) {
          var a = document.createElement('a');
          a.className = 'gal__link';
          a.textContent = t.name;
          a.setAttribute('role', 'button');
          a.setAttribute('data-target', 'tpl-' + t.id);
          a.addEventListener('click', function () {
            var el = document.getElementById(this.getAttribute('data-target'));
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
          nav.appendChild(a);

          var item = document.createElement('section');
          item.className = 'gal__item';
          item.id = 'tpl-' + t.id;

          var bar = '<div class="gal__bar"><h2 class="gal__name">' + t.name +
            '</h2><span class="gal__badge">' + t.category + '</span></div>' +
            '<p class="gal__subject">Subject: <b>' + t.subject + '</b></p>';

          var vp = '<div class="gal__viewport" role="group" aria-label="Viewport">' +
            '<button type="button" class="gal__vp-btn is-active" data-vp="desktop">Desktop</button>' +
            '<button type="button" class="gal__vp-btn" data-vp="mobile">Mobile</button></div>';

          item.innerHTML = bar + vp + '<div class="gal__stage" data-stage></div>';
          main.appendChild(item);

          var stage = item.querySelector('[data-stage]');
          var body = T.renderBody(t.id);

          function paintDesktop() {
            stage.className = 'gal__stage';
            stage.innerHTML = body;
          }
          function paintMobile() {
            // Same email, rendered in a phone-width iframe so its own media
            // queries fire — responsive, not a different design.
            stage.className = 'gal__stage gal__stage--mobile';
            stage.innerHTML = '<iframe class="gal__phone" title="Mobile preview"></iframe>';
            stage.querySelector('iframe').srcdoc = mobileDoc(body);
          }
          paintDesktop();

          item.querySelectorAll('[data-vp]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              item.querySelectorAll('[data-vp]').forEach(function (b) { b.classList.remove('is-active'); });
              btn.classList.add('is-active');
              if (btn.getAttribute('data-vp') === 'mobile') paintMobile(); else paintDesktop();
            });
          });
        });
      });

      // Highlight the sidebar link for whatever section is in view.
      var links = Array.prototype.slice.call(nav.querySelectorAll('.gal__link'));
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (l) {
            l.classList.toggle('is-active', l.getAttribute('data-target') === en.target.id);
          });
        });
      }, { rootMargin: '-10% 0px -80% 0px' });
      main.querySelectorAll('.gal__item').forEach(function (s) { obs.observe(s); });
    })();
  </script>
</body>
</html>
