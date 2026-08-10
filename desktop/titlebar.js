'use strict';

/*
 * The brand-blue title bar.
 *
 * macOS will not tint a native title bar. `backgroundColor` only paints the web
 * area before the page loads, and the frame itself is drawn by AppKit in the
 * system appearance — verified, not assumed. The only way to a coloured bar is
 * to hide the native one (`titleBarStyle: 'hidden'`) and draw our own.
 *
 * Drawing it means putting something into the portal page, which is the risky
 * part: that page is the real web app, served to browsers too. So none of this
 * lives in the portal's stylesheets. It is injected at runtime by the shell and
 * exists only inside the app — a browser never sees it, and no portal CSS file
 * can be broken by it.
 *
 * Windows works the same way with one addition: its minimise/maximise/close
 * buttons stay native and are drawn by the OS over the right-hand end of the
 * strip, so `titleBarOverlay` has to be given the same blue or they sit in a
 * grey box on top of it.
 */

const HEIGHT = 52;

// --color-primary from public/css/tokens.css. The one the design system calls
// primary, not --color-blue (#7dbbff), which is the lighter badge blue.
const BLUE = '#03a5e9';

/**
 * Every platform-dependent number in one place, taken as an argument rather
 * than read from process.platform, so the Windows layout can be built — and
 * measured by the tests — on a Mac. Getting it wrong is invisible from here:
 * nothing on macOS reserves space at the right, so a Windows-only overlap
 * shows up only on Windows.
 */
function metrics(platform) {
  const isMac = platform === 'darwin';

  return {
    isMac,

    // Traffic lights + back/forward/reload + separator + heading. The header is
    // padded by this much so its own contents start clear of them.
    controls: isMac ? 300 : 250,

    /*
     * What the OS draws over our strip at the right-hand end.
     *
     * On Windows the minimise/maximise/close buttons stay native and are
     * painted on top of the window by the compositor — they are not in the page
     * and no z-index reaches them. Anything the portal puts under them is both
     * invisible and unclickable, so that width has to be reserved. Three
     * caption buttons at 46px. macOS puts its traffic lights at the left, and
     * we draw those ourselves, so nothing is reserved at the right.
     */
    caption: isMac ? 0 : 138,

    // The strip's own inset. On macOS the left side clears the traffic lights.
    barPadLeft: isMac ? 92 : 8,
  };
}

/**
 * Pushes the page down by the bar's height.
 *
 * `.tma-dash` is `height: 100vh`, so padding alone would make every portal
 * screen a bar taller than the window and hand it a scrollbar it never had.
 * The shell has to shrink by exactly what the padding adds.
 */
function buildCss(platform = process.platform) {
  const {
    isMac, controls, caption, barPadLeft,
  } = metrics(platform);

  return `
  body { padding-top: ${HEIGHT}px !important; }

  .tma-dash {
    height: calc(100vh - ${HEIGHT}px) !important;
    min-height: calc(100vh - ${HEIGHT}px) !important;
  }

  /*
   * The portal header is restyled into the fixed blue bar, so it must not keep
   * a grid row of its own. An auto row sized to the header's old padding
   * (space-20 × 2 + search ≈ 80px) is exactly the empty white band that opened
   * under the bar on Email after row actions — Mail has no page-title to fill
   * that slot, so the hole read as blank chrome.
   */
  .tma-dash--desktop-bar {
    grid-template-rows: 0 minmax(0, 1fr) !important;
  }
  .tma-dash--desktop-bar .tma-dash__main {
    grid-row: 1 / -1 !important;
  }
  /* Every app page keeps a top inset under the title bar — Email only is flush. */
  .tma-dash--desktop-bar:not(.tma-dash--email) .tma-dash__main {
    padding-top: var(--space-28, 28px) !important;
    padding-left: var(--space-28, 28px) !important;
    padding-right: var(--space-28, 28px) !important;
  }
  .tma-dash--desktop-bar.tma-dash--email .tma-dash__main {
    padding-top: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
  .tma-dash--desktop-bar.tma-dash--email .tma-dash__main-head {
    display: none !important;
    height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    border: 0 !important;
  }

  /*
   * Body padding moves everything in normal flow, but position:fixed anchors to
   * the viewport and ignores it. Parts of the shell become fixed at top:0 — and
   * then sit *under* the bar. The sidebar was the visible one: its logo is the
   * first thing in it, so the logo went half-missing.
   *
   * Each rule below mirrors the exact selector and breakpoint that makes the
   * element fixed in dashboard.css. The offset cannot be set unconditionally,
   * because these same elements are position:relative in their other states,
   * where an offset would shove them down instead.
   *
   * Deliberately absent: .tma-dash__mmenu and .tma-dash__scrim. Those are
   * takeovers and are supposed to cover the bar — see the note above.
   */
  @media (min-width: 1025px) {
    /* Hover-style rail, collapsed — dashboard.css "held fixed in both states". */
    .tma-dash.is-sidebar-collapsed:not(.tma-dash--sidebar-standard) .tma-dash__sidebar {
      top: ${HEIGHT}px !important;
    }
  }

  @media (max-width: 1024px) {
    /* Narrow window: the rail and rightbar become drawers, pinned below the bar.
       The header is deliberately not in this list — see the narrow-window
       section at the foot of this file, where it stays the bar itself. */
    .tma-dash__sidebar,
    .tma-dash__rightbar {
      top: ${HEIGHT}px !important;
    }
  }

  /*
   * Full width by default. The strip is only narrow where the portal shell
   * exists to supply the rest of the row — on sign-in, or the error page, there
   * is no .tma-dash__header to restyle, and a 300px stub of blue against a
   * white page is not a title bar.
   */
  #tma-desktop-titlebar {
    position: fixed !important;
    top: 0; left: 0;
    width: 100%;
    height: ${HEIGHT}px;
    /* Never participate in .tma-dash's grid if a host puts us there. */
    grid-area: unset !important;
    margin: 0 !important;
    /*
     * Above ordinary content and scrims, deliberately below the portal's
     * full-viewport takeovers — email settings / portal modals are 300, the
     * signature wizard is 280, and the layer scale runs to 2000. Those are
     * position:fixed with inset:0, so they ignore the body padding above and
     * start at the very top of the window; a bar sitting over them would clip
     * their headers and close buttons. Letting them cover the bar instead
     * costs nothing but the blue strip while they are open, which is what a
     * takeover is meant to do. Anything new that is a full-window dialog must
     * sit above 201 or it will open under this strip in the desktop app.
     */
    z-index: 201;
    background: ${BLUE};
    color: #fff;
    display: flex;
    align-items: center;
    /* Traffic lights sit at the left on macOS; Windows puts its caption
       buttons at the right. Either way the controls need to clear them. */
    padding: 0 ${Math.max(caption, 12)}px 0 ${barPadLeft}px;
    font: 600 13px/1 -apple-system, "Segoe UI", system-ui, sans-serif;
    letter-spacing: 0.01em;
    /* The whole strip is the drag handle, standing in for the frame we hid. */
    -webkit-app-region: drag;
    -webkit-user-select: none;
    user-select: none;
  }

  #tma-desktop-titlebar .tma-tb-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    /* Carved out of the drag region, or the buttons swallow their own clicks. */
    -webkit-app-region: no-drag;
    /* Never squeezed. The strip is a fixed width beside the shell, and a flex
       item that may shrink gives up its width silently — the buttons narrow
       and the heading beside them ends up at zero. */
    flex: none;
  }

  #tma-desktop-titlebar .tma-tb-btn {
    all: unset;
    box-sizing: border-box;
    /* Matches .tma-dash__header .tma-dash__icon-btn — same size, same radius,
       so the window controls and the header's own buttons sit on one line
       rather than looking like two toolbars that happen to touch. */
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    color: #fff;
    opacity: 0.82;
    transition: background-color 120ms ease, opacity 120ms ease;
  }

  #tma-desktop-titlebar .tma-tb-btn:hover { opacity: 1; background: rgba(255,255,255,0.18); }
  #tma-desktop-titlebar .tma-tb-btn:active { background: rgba(255,255,255,0.28); }

  #tma-desktop-titlebar .tma-tb-btn[disabled] {
    opacity: 0.32;
    pointer-events: none;
  }

  #tma-desktop-titlebar .tma-tb-btn svg {
    width: 17px;
    height: 17px;
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  #tma-desktop-titlebar .tma-tb-sep {
    opacity: 0.45;
    margin: 0 7px 0 10px;
    font-weight: 400;
  }

  #tma-desktop-titlebar .tma-tb-title {
    max-width: 60vw;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Centred on the window, not on what is left over beside the controls, so it
     does not drift as the title changes length. */
  #tma-desktop-titlebar .tma-tb-center,
  #tma-desktop-titlebar .tma-tb-right { display: none; }

  /*
   * The portal's own header IS the bar.
   *
   * The first attempt moved the search and the toolbar icons into this element.
   * They would not stay: the portal reconciles .tma-dash through TMAMorph,
   * which knows nothing about nodes lifted out from under it and puts them
   * straight back — and re-taking them every render is a tug-of-war, not a fix.
   * Worse, hiding the emptied header took the search and every icon with it.
   *
   * So nothing moves. The header is restyled in place into the blue strip, and
   * the window controls are drawn in a strip on top of its left end. Morph can
   * rebuild the header as often as it likes; injected CSS applies to whatever
   * it puts there.
   */
  .tma-desktop-has-shell #tma-desktop-titlebar {
    width: ${controls}px;
    /*
     * The caption reserve above is dropped here, and has to be. It exists to
     * keep content out from under buttons the OS draws at the *window's* right
     * edge — but beside the shell this strip is only ${controls}px wide and
     * sits at the left, nowhere near them. Kept, it ate the strip from the
     * inside: 138 of 250px reserved for buttons that are hundreds of pixels
     * away left barely enough for the three nav buttons and nothing at all for
     * the heading, so the page title was laid out at zero width. It was never
     * missing or hidden behind anything — it was squeezed out.
     */
    padding-right: 12px;
  }
  .tma-desktop-has-shell #tma-desktop-titlebar .tma-tb-title { max-width: 24vw; }

  /*
   * Sign-in and the error page get exactly the same bar as everywhere else:
   * full-width, brand blue, white controls. It was briefly transparent there —
   * which was accurate (those pages have no toolbar to carry) but read as a
   * different app the moment you moved between them. One chrome, everywhere.
   */

  .tma-dash--desktop-bar .tma-dash__header {
    position: fixed !important;
    top: 0; left: 0; right: 0;
    height: ${HEIGHT}px !important;
    min-height: ${HEIGHT}px !important;
    z-index: 200;
    background: ${BLUE} !important;
    border: 0 !important;
    box-shadow: none !important;
    /*
     * Symmetric padding, deliberately. The header is
     * minmax(0,1fr) auto minmax(0,1fr), so its centre column is centred in
     * the *content box* — padding the left side to clear the window controls
     * shrank that box from one side and pushed the search right by half of it.
     * The controls are cleared by insetting the left cell's contents instead,
     * which leaves the 1fr tracks equal and the search on the window's centre.
     */
    padding: 0 14px !important;
    gap: 12px;
  }

  .tma-dash--desktop-bar .tma-dash__header-left {
    padding-left: ${controls - 14}px;
  }

  /*
   * The mirror of the left inset, for the OS's own caption buttons.
   *
   * The header runs the full width of the window, so on Windows its right-hand
   * end is underneath the native minimise/maximise/close buttons — and the last
   * thing in that end is the right-panel toggle, which was therefore covered by
   * the close button and could not be clicked.
   *
   * Inset on the cell, not as header padding, for the same reason as the left:
   * the header is minmax(0,1fr) auto minmax(0,1fr) and padding on the header
   * would shrink the box the centre column is centred in, dragging the search
   * off the window's centre. Zero on macOS, where we draw the controls
   * ourselves at the other end.
   */
  .tma-dash--desktop-bar .tma-dash__header-right {
    padding-right: ${Math.max(caption - 14, 0)}px;
  }

  /* The heading lives in the controls strip, so the crumb is a duplicate. */
  .tma-dash--desktop-bar .tma-dash__breadcrumb { display: none !important; }

  .tma-dash--desktop-bar .tma-dash__search {
    min-width: 260px;
    background: rgba(255,255,255,0.16) !important;
    border-color: transparent !important;
  }
  .tma-dash--desktop-bar .tma-dash__search:hover { background: rgba(255,255,255,0.24) !important; }
  .tma-dash--desktop-bar .tma-dash__search-text,
  .tma-dash--desktop-bar .tma-dash__kbd { color: rgba(255,255,255,0.9) !important; }
  .tma-dash--desktop-bar .tma-dash__kbd { border-color: rgba(255,255,255,0.4) !important; }

  .tma-dash--desktop-bar .tma-dash__header .tma-dash__icon-btn:hover {
    background: rgba(255,255,255,0.18) !important;
  }

  /* Header artwork is dark; knocked out to white to sit on the blue. */
  .tma-dash--desktop-bar .tma-dash__header img { filter: brightness(0) invert(1); }

  /*
   * The unread counts. The class is .tma-dash__icon-btn-badge — a red pill with
   * white text, and a <span>, so the white knock-out above (which is scoped to
   * img) leaves it alone. A ring in the bar colour separates the pill from the
   * blue the way it was separated from the white header it was drawn for.
   */
  .tma-dash--desktop-bar .tma-dash__header .tma-dash__icon-btn-badge {
    box-shadow: 0 0 0 2px ${BLUE};
    z-index: 2;
  }

  .tma-dash--desktop-bar .tma-dash__sidebar-logo { display: none !important; }
  .tma-dash--desktop-bar .tma-dash__page-title { display: none !important; }

  /*
   * ── The narrow window ────────────────────────────────────────────────────
   *
   * Below 1025px the portal switches to its phone layout: the search, the
   * activity button and the notification bell are all hidden, because on a
   * phone they live in the bottom tab bar instead, and the header becomes a
   * transparent overlay floating above the content.
   *
   * That is right for a phone and wrong for this window, and the app reaches it
   * far more easily than a desktop browser does. Windows laptops commonly run
   * at 125% or 150% display scaling, which divides the usable CSS width: a
   * 1366px panel at 150% is 911px, so the app *maximised* is inside the phone
   * band. The window cannot go under 960px (minWidth), so the whole band this
   * has to cover is 960-1024 — narrow, but where a good number of Windows
   * machines sit by default. It is why the bar looked stripped there while the
   * same build on a Mac looked complete.
   *
   * So the desktop chrome is put back for those widths. Only the chrome: the
   * rail and rightbar stay drawers and the tab bar stays, which is the right
   * shape for a small window. Scoped to .tma-dash--desktop-bar throughout, so a
   * browser at the same width is untouched and still gets the phone layout.
   */
  @media (max-width: 1024px) {
    /*
     * The header is the bar, at every width. The phone layout floats it over
     * the content at top:0 with the page scrolling underneath; here it stays
     * put in the strip the body padding has already reserved for it.
     */
    .tma-dash--desktop-bar .tma-dash__header {
      top: 0 !important;
      pointer-events: auto !important;
      padding: 0 14px !important;
    }

    /* The search is the one control people go looking for by name. */
    .tma-dash--desktop-bar .tma-dash__header-center > .tma-dash__search {
      display: flex !important;
    }

    /* It cannot keep its 260px floor in a 960px window and leave room for the
       strip, the icons and the caption buttons, so it is allowed to shrink. */
    .tma-dash--desktop-bar .tma-dash__search {
      min-width: 0 !important;
      width: 100%;
    }

    .tma-dash--desktop-bar .tma-dash__header-icons [data-action="toggle-activities-popup"],
    .tma-dash--desktop-bar .tma-dash__header-icons [data-action="toggle-notifications-popup"] {
      display: grid !important;
    }

    /*
     * The phone layout groups the icons into one bordered pill on a card
     * background. On the blue that reads as a white box sitting in the bar, so
     * the group is flattened back to plain buttons at the size they are at
     * every other width.
     */
    .tma-dash--desktop-bar .tma-dash__header-icons {
      background: transparent !important;
      border: 0 !important;
      border-radius: 0 !important;
      gap: 2px;
    }

    .tma-dash--desktop-bar .tma-dash__header-icons .tma-dash__icon-btn {
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      min-height: 32px !important;
      border-radius: 8px !important;
      border-right: 0 !important;
      background: transparent !important;
    }

    /*
     * The phone layout reserves a header's worth of space at the top of the
     * scroller, because there the header floats over it. Here the body padding
     * already accounts for the bar — so drop the mobile header clearance, but
     * keep a normal content inset for Dashboard (Email stays flush).
     */
    .tma-dash--desktop-bar:not(.tma-dash--email) .tma-dash__main {
      padding-top: var(--space-16, 16px) !important;
    }

    /* Email's mobile clearance must not win inside the desktop shell. */
    .tma-dash--desktop-bar.tma-dash--email .tma-dash__main,
    .tma-dash--desktop-bar.tma-dash--email.tma-dash--email-mobile .tma-dash__main,
    .tma-dash--desktop-bar.tma-dash--email.tma-dash--email-mobile-reading .tma-dash__main {
      padding-top: 0 !important;
    }
  }
`;
}

const CSS = buildCss();

const ICONS = {
  back: '<path d="M10 3 L5 8 L10 13"/>',
  forward: '<path d="M6 3 L11 8 L6 13"/>',
  // Circular arrow: an arc left open at the top right, with the head on it.
  reload: '<path d="M13 8a5 5 0 1 1-1.7-3.7"/><path d="M13 2.5V5.4H10.1"/>',
};

/**
 * Re-asserted on every load and in-page navigation rather than done once: the
 * portal is a single-page app whose views reconcile through TMAMorph, and a
 * node it did not put there is not guaranteed to survive a re-render.
 *
 * Navigation runs through the page's own session history rather than new IPC.
 * It is the same history the Go menu drives through webContents, so Back here
 * and Back there land in the same place — and it keeps the preload's surface
 * exactly as small as it is, which is the point of that file.
 *
 * Whether there is anywhere to go back or forward *to* is not knowable in the
 * page (history.length counts entries, not position), so the main process
 * passes it in and the buttons are rebuilt with it on every navigation.
 */
function script({ canGoBack, canGoForward }) {
  const button = (name, label, enabled) => `
    <button class="tma-tb-btn" data-tb="${name}" title="${label}" aria-label="${label}"
      ${enabled ? '' : 'disabled'}>
      <svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>
    </button>`;

  return `
  (() => {
    let bar = document.getElementById('tma-desktop-titlebar');

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tma-desktop-titlebar';
    }

    /*
     * Mounted on <body>, not inside .tma-dash. The shell is a CSS grid; a child
     * without an explicit grid area is auto-placed into a fresh track. Even a
     * position:fixed node has been observed to leave an empty row after morph
     * fights — and that row was the white band under the bar on Email. The bar
     * owns its own click handlers, so it does not need to live under the dash
     * root that dashboard.js queries.
     */
    if (bar.parentElement !== document.body) document.body.appendChild(bar);

    bar.innerHTML = ${JSON.stringify(
    '<div class="tma-tb-nav">'
      + button('back', 'Back', canGoBack).trim()
      + button('forward', 'Forward', canGoForward).trim()
      + button('reload', 'Reload', true).trim()
      + '</div>'
      + '<span class="tma-tb-sep">|</span>'
      + '<span class="tma-tb-title"></span>',
  )};

    const nav = bar.querySelector('.tma-tb-nav');
    const title = bar.querySelector('.tma-tb-title');

    /*
     * Nothing is moved out of the portal's header — see the CSS note. The class
     * is all this needs to do: the header restyles itself into the blue strip,
     * and morph can rebuild its contents as often as it likes.
     *
     * Re-asserted on a MutationObserver too: a full shell morph can replace
     * .tma-dash and drop the class, and in-page view switches do not fire a
     * navigation for refresh() to run again.
     */
    const markDesktopBar = () => {
      const dash = document.querySelector('.tma-dash');
      if (dash && !dash.classList.contains('tma-dash--desktop-bar')) {
        dash.classList.add('tma-dash--desktop-bar');
      }
      document.documentElement.classList.toggle('tma-desktop-has-shell', !!dash);
      return dash;
    };
    let dashWatch = markDesktopBar();
    let dashClassWatch = null;
    const watchDashClass = (dash) => {
      if (dashClassWatch) {
        dashClassWatch.disconnect();
        dashClassWatch = null;
      }
      if (!dash) return;
      dashClassWatch = new MutationObserver(() => {
        if (!dash.classList.contains('tma-dash--desktop-bar')) {
          dash.classList.add('tma-dash--desktop-bar');
        }
      });
      dashClassWatch.observe(dash, { attributes: true, attributeFilter: ['class'] });
    };
    if (!document.documentElement.dataset.tmaTbClassWatch) {
      document.documentElement.dataset.tmaTbClassWatch = '1';
      watchDashClass(dashWatch);
      // .tma-dash is a direct child of body — only watch those replacements.
      new MutationObserver(() => {
        const dash = document.querySelector('.tma-dash');
        if (dash !== dashWatch) {
          dashWatch = markDesktopBar();
          watchDashClass(dashWatch);
        }
      }).observe(document.body, { childList: true });
    }

    /*
     * The page's own heading, not document.title — that one is prefixed with
     * the unread count ("(388) Dashboard"), which belongs on the badge rather
     * than in the middle of the chrome.
     */
    const heading = () => {
      const el = document.querySelector('[data-page-title]')
        || document.querySelector('.tma-dash__crumb--current');
      const text = el && el.textContent.trim();
      /*
       * Every backslash below is doubled, and has to be. This function is built
       * inside a template literal, where backslash-s and backslash-d are not
       * valid escapes and the backslash is simply dropped — written singly they
       * reach the page as plain letters and quietly match nothing, which is why
       * the unread count was never actually being stripped.
       *
       * Regex literals are deliberately not quoted in this comment: a slash
       * after an asterisk would close the comment early and turn the prose that
       * follows into code.
       */
      return text
        || (document.title || '')
          // The unread count belongs on the badge, not in the chrome.
          .replace(/^\\(\\d+\\)\\s*/, '')
          // And "Sign In — TM ANTOINE Advisory" is the app telling you its own
          // name inside its own window.
          .split(/\\s+[—–|]\\s+/)[0]
          .trim()
        || 'TM ANTOINE Portal';
    };

    const paint = () => { title.textContent = heading(); };
    paint();

    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tb]');
      if (!btn) return;
      const action = btn.getAttribute('data-tb');
      if (action === 'back') history.back();
      else if (action === 'forward') history.forward();
      else location.reload();
    });

    // The title carries the unread count — "(388) Dashboard" — so it changes
    // without a navigation. Watch the element, once per document.
    if (!document.documentElement.dataset.tmaTbWatching) {
      document.documentElement.dataset.tmaTbWatching = '1';
      const el = document.querySelector('title');
      if (el) new MutationObserver(() => {
        const t = document.getElementById('tma-desktop-titlebar');
        const s = t && t.querySelector('.tma-tb-title');
        if (s) s.textContent = heading();
      }).observe(el, { childList: true });
    }
  })();
`;
}

/**
 * Options for the BrowserWindow. On macOS the traffic lights are nudged to sit
 * centred in a 38px bar rather than the 28px one they are placed for by
 * default; on Windows the native caption buttons are told to match the blue.
 */
function windowOptions() {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      /*
       * Derived, not a constant. These were left at the offsets that centred
       * them in a 38px bar, so raising the bar to 52 left them sitting high of
       * everything else in the row. A traffic light is 12px.
       */
      trafficLightPosition: { x: 18, y: Math.round((HEIGHT - 12) / 2) },
    };
  }

  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BLUE, symbolColor: '#ffffff', height: HEIGHT },
  };
}

/**
 * Draws the bar, and re-draws it to pick up a changed Back/Forward state.
 *
 * Cheap enough to run on every navigation: it replaces one small subtree and
 * touches no stylesheet.
 */
async function refresh(webContents) {
  try {
    const history = webContents.navigationHistory;

    await webContents.executeJavaScript(script({
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    }), true);
  } catch {
    // A page that went away mid-injection is not worth reporting; the next
    // navigation draws it again.
  }
}

/**
 * The full pass, for a freshly loaded document.
 *
 * insertCSS is deliberately *not* part of refresh(): a stylesheet inserted this
 * way lives as long as the document does, so re-inserting it on every in-page
 * navigation would stack a fresh copy each time — and the portal navigates by
 * pushState, so that is most of them.
 */
async function apply(webContents) {
  try {
    await webContents.insertCSS(CSS);
  } catch {
    // As above — a page that went away takes its stylesheet with it.
  }

  await refresh(webContents);
}

// `script` is exported for tests: it is a template literal that builds
// JavaScript, and a stray backslash or backtick in it is a syntax error the
// page swallows silently. Checking the emitted text is the only way to catch it.
// `buildCss` and `metrics` are exported for the same reason: the Windows layout
// has to be measurable from a Mac, or its two reserved-space bugs are only ever
// found by shipping.
module.exports = {
  apply, refresh, windowOptions, script, buildCss, metrics, CSS, HEIGHT, BLUE,
};
