/*
 * TMA. The portal's own pictures load when they are on screen.
 *
 * Every screen of the portal is drawn into the one page up front and kept
 * hidden until it is opened, so a page load asked for ~150 pictures (the
 * icons of the email, settings, calendar and feed screens, and every face in
 * every list) when ~50 were showing. Laravel Cloud's edge blocks an IP that
 * sends more than 100 requests a minute (rate-limit.js), so a single cold
 * load could block the office on its own, and after a block every reload
 * asked for all of them again, since a refused picture is never cached.
 *
 * An <img> naming one of the portal's own icons or faces (images/,
 * /media/avatars/, a mail sender's photo, a group's photo) with no loading=
 * of its own is given loading="lazy" as it is
 * written: the browser then fetches it when it is shown, which for a picture
 * on a screen in view is at once. One place rather than the ~980 templates
 * that write <img>: innerHTML, outerHTML and insertAdjacentHTML.
 *
 * Not touched: blob:/data: pictures (an editor or cropper that waits on its
 * load), images made with new Image()/createElement, and any <img> that says
 * loading= itself. The shell's own <img> tags say it in dashboard.html.
 *
 * Global: window.TMALazyPictures ({ mark })
 */
(function () {
  'use strict';

  if (window.TMALazyPictures) return;

  // `<img` with no loading= in the tag, whose src is one of the portal's own
  // icons or faces, relative or on this origin. A chat's photos and a file's
  // preview are left as they were: a thread pins itself to the bottom as
  // they load, and a late one would move what the reader is looking at.
  var origin = location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var PICTURES = '(?:images/|media/avatars/|portal/mail/sender-photo/|portal/messaging/conversations/[^/"\'\\s>]+/photo)';
  var TAG = new RegExp(
    '<img(?=[\\s/>])(?![^>]*\\sloading\\s*=)(?=[^>]*\\ssrc\\s*=\\s*["\']?(?:' + origin + ')?\\.?/?' + PICTURES + ')',
    'g'
  );

  function mark(html) {
    if (typeof html !== 'string' || html.indexOf('<img') === -1) return html;
    TAG.lastIndex = 0;
    return html.replace(TAG, '<img loading="lazy"');
  }

  function wrapSetter(proto, name) {
    var desc = proto && Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.set !== 'function' || !desc.configurable) return;
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (value) { desc.set.call(this, mark(value)); },
    });
  }

  function owner(name) {
    if (Object.prototype.hasOwnProperty.call(Element.prototype, name)) return Element.prototype;
    return typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : null;
  }

  try {
    wrapSetter(owner('innerHTML'), 'innerHTML');
    wrapSetter(owner('outerHTML'), 'outerHTML');
    var adjacent = Element.prototype.insertAdjacentHTML;
    if (typeof adjacent === 'function') {
      Element.prototype.insertAdjacentHTML = function (position, html) {
        return adjacent.call(this, position, mark(html));
      };
    }
  } catch (e) { /* an engine that will not let us: pictures load as before */ }

  window.TMALazyPictures = { mark: mark };
})();
