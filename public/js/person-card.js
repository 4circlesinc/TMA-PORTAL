/**
 * TMA — people on a record, and the card that answers "who is this?"
 * Global: window.TMAPersonCard
 *
 * Two halves of one idea:
 *
 *   faces(people)  the cell: overlapping circles with the names beside them.
 *                  Repeating face-name, face-name down a column made four
 *                  colleagues look like four separate facts; one pile with one
 *                  list reads as the single answer it is — who has this record.
 *
 *   the card       hovering (or focusing) a face gives the full name, the roles
 *                  that person holds here, and the three things you would open
 *                  a colleague's card to do. It lives on the body, so a
 *                  re-render of the table underneath cannot destroy it
 *                  mid-hover.
 *
 * This began inside cbi.js for the Assigned column. The File Library's Owner
 * column wanted the same thing, and a second copy would have been two things
 * to keep in step, so it moved here whole. Anything that can list people can
 * use it: hand it person objects, put the markup in a cell, call wire() once.
 *
 * A person is { name, email, photo, userId, roles[], first }. Only `name` is
 * required. `userId` is what decides whether the actions work at all — many
 * people in the caseload have no portal account, and a button that cannot work
 * is worse than one that is not there, so those are disabled with the reason
 * given rather than hidden.
 */
(function () {
  'use strict';

  var PH_ICON = 'images/icons/phosphor/';

  function ui() { return window.TMAPortalUI || null; }

  function esc(s) {
    if (ui() && ui().esc) return ui().esc(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* The portal's one avatar resolver: a real photo, else initials on a colour
     hashed from the name. Never an invented avatar. */
  function faceSrc(person) {
    if (person.photo) return person.photo;
    var cu = window.TMACurrentUser;
    if (cu && cu.initialsFor) return cu.initialsFor(person.name, person.email || person.name);
    return '';
  }

  /* TMAPortalUI's toast, the one the pages that render faces already use.
     window.TMAToast is a different, lower-level renderer — not this. */
  function toast(message, ok) {
    if (ui() && ui().toast) {
      ok === false ? ui().toastError(message) : ui().toast(message);
      return;
    }
    console[ok === false ? 'error' : 'log']('[person-card]', message);
  }

  /*
   * The cell.
   *
   * The people are serialised onto the wrapper and each face carries its index
   * into that list, so the card resolves a face back to a person without
   * re-parsing what the face already knows — and without the caller having to
   * keep a lookup alive across re-renders.
   */
  function faces(people, opts) {
    var list = people || [];
    var o = opts || {};
    if (!list.length) {
      return '<span class="tma-people__empty">' + esc(o.emptyLabel || 'Unassigned') + '</span>';
    }

    var shown = o.max ? list.slice(0, o.max) : list;
    var hidden = list.length - shown.length;

    var art = shown.map(function (p, i) {
      var src = faceSrc(p);
      if (!src) return '';
      return '<img class="tma-people__face" src="' + esc(src) + '" alt="" width="24" height="24"' +
        ' data-tma-person="' + i + '" tabindex="0" loading="lazy">';
    }).join('');

    // The overflow count is a face-shaped thing in the pile rather than a note
    // beside it, so the row's width does not depend on how many people it has.
    if (hidden > 0) {
      art += '<span class="tma-people__face tma-people__face--more" aria-hidden="true">+' + hidden + '</span>';
    }

    var names = list.map(function (p) { return p.first || p.name; }).join(', ');

    return '<span class="tma-people" data-tma-people="' + esc(JSON.stringify(list)) + '">' +
      (art ? '<span class="tma-people__faces">' + art + '</span>' : '') +
      '<span class="tma-people__names">' + esc(names) + '</span></span>';
  }

  /* ── the card ── */

  var card = null;
  var hideTimer = null;

  function ensureCard() {
    if (card && document.body.contains(card)) return card;
    card = document.createElement('div');
    card.className = 'tma-person-card';
    card.setAttribute('aria-hidden', 'true');
    document.body.appendChild(card);

    // The card must survive the pointer travelling from the face onto it.
    card.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
    card.addEventListener('mouseleave', hide);
    card.addEventListener('click', onCardClick);
    return card;
  }

  function hide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!card) return;
      card.removeAttribute('data-open');
      card.setAttribute('aria-hidden', 'true');
    }, 160);
  }

  function personFor(face) {
    var wrap = face.closest('[data-tma-people]');
    if (!wrap) return null;
    var people;
    try { people = JSON.parse(wrap.getAttribute('data-tma-people')); } catch (e) { return null; }
    return people[Number(face.getAttribute('data-tma-person'))] || null;
  }

  function show(face) {
    var person = personFor(face);
    if (!person) return;

    clearTimeout(hideTimer);
    var el = ensureCard();
    var src = faceSrc(person);
    var reachable = !!person.userId;

    el.innerHTML =
      '<div class="tma-person-card__head">' +
      (src ? '<img class="tma-person-card__avatar" src="' + esc(src) + '" alt="" width="48" height="48">' : '') +
      '<div class="tma-person-card__ident">' +
      '<span class="tma-person-card__name">' + esc(person.name) + '</span>' +
      '<span class="tma-person-card__roles">' + esc((person.roles || []).join(' · ')) + '</span>' +
      (person.email ? '<span class="tma-person-card__email">' + esc(person.email) + '</span>' : '') +
      '</div></div>' +
      '<div class="tma-person-card__actions">' +
      action('message', 'ChatTeardropDots', 'Message', reachable, person) +
      action('call', 'Phone', 'Call', reachable, person) +
      action('video', 'VideoCamera', 'Video', reachable, person) +
      '</div>' +
      (reachable ? '' : '<p class="tma-person-card__note">No portal account yet.</p>');

    el.setAttribute('data-open', 'true');
    el.setAttribute('aria-hidden', 'false');
    position(el, face.getBoundingClientRect());
  }

  function action(name, icon, label, enabled, person) {
    return '<button type="button" class="tma-person-card__action" data-tma-person-action="' + name + '"' +
      ' data-tma-person-id="' + esc(String(person.userId || '')) + '"' +
      ' data-tma-person-name="' + esc(person.name) + '"' +
      ' data-tma-person-photo="' + esc(person.photo || '') + '"' +
      (enabled ? '' : ' disabled') + '>' +
      '<img src="' + PH_ICON + icon + '.svg" alt="" width="16" height="16">' +
      '<span>' + esc(label) + '</span></button>';
  }

  function position(el, rect) {
    requestAnimationFrame(function () {
      var w = el.offsetWidth || 260;
      var h = el.offsetHeight || 140;
      var left = Math.min(Math.max(8, rect.left - 8), window.innerWidth - w - 8);
      // Above the face when there is no room below, the way the filter
      // popovers flip.
      var top = rect.bottom + 8;
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    });
  }

  function onCardClick(e) {
    var btn = e.target.closest('[data-tma-person-action]');
    if (!btn || btn.disabled) return;
    e.preventDefault();

    var userId = Number(btn.getAttribute('data-tma-person-id'));
    var name = btn.getAttribute('data-tma-person-name');
    var photo = btn.getAttribute('data-tma-person-photo') || null;
    var act = btn.getAttribute('data-tma-person-action');
    if (!userId) return;

    var api = window.TMAMessagingAPI;
    if (!api || !api.openDirect) { toast('Messaging is not available here.', false); return; }

    btn.disabled = true;
    api.openDirect(userId).then(function (res) {
      var id = res && (res.conversation ? (res.conversation.id || res.conversation.uuid) : (res.id || res.uuid));
      if (!id) throw new Error('no conversation');

      if (act === 'message') {
        // The thread is the destination; the Messages page opens on it.
        location.href = (window.__TMA_SITE_ROOT || '') + '/social/messages?conversation=' + encodeURIComponent(id);

        return;
      }

      var calls = window.TMAMessagingCalls;
      if (!calls || !calls.start) { toast('Calling is not available here.', false); return; }
      calls.start(id, act === 'video' ? 'video' : 'audio', name, photo);
      hide();
    }).catch(function () {
      toast('Could not reach ' + name + '.', false);
    }).finally(function () {
      btn.disabled = false;
    });
  }

  /*
   * Delegated on the document, once for the whole application: the faces are
   * rebuilt on every render, and a listener bound to them would be lost with
   * the nodes it was bound to.
   */
  var wired = false;

  function wire() {
    if (wired) return;
    wired = true;

    document.addEventListener('mouseover', function (e) {
      var face = e.target.closest && e.target.closest('[data-tma-person]');
      if (face) show(face);
    });
    document.addEventListener('mouseout', function (e) {
      var face = e.target.closest && e.target.closest('[data-tma-person]');
      // Only when the pointer actually leaves the face, not on a child.
      if (face && !face.contains(e.relatedTarget)) hide();
    });
    // Keyboard: the faces are focusable, so the card has to answer to focus.
    document.addEventListener('focusin', function (e) {
      var face = e.target.closest && e.target.closest('[data-tma-person]');
      if (face) show(face);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hide();
    });
  }

  window.TMAPersonCard = { faces: faces, wire: wire, hide: hide };

  // Nothing to wait for: the listeners are on the document and the card is
  // built on first use, so wiring at load costs one call and means a page that
  // renders faces never has to remember to ask.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
