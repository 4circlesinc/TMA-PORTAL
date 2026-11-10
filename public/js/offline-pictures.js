/*
 * TMA. People's pictures with no connection, in the apps.
 *
 * Profile photos, a mail sender's face, a group's photo, a passport photo:
 * all are <img> loads from the portal, and with no connection every one of
 * them failed and fell back to initials, so the reopened app looked like a
 * stranger's. A picture that loads while connected is kept (the Cache API,
 * on this device only), and when one fails to load it is put back from the
 * copy. Bounded: the most recent PICTURE_LIMIT pictures, older ones dropped.
 *
 * The apps only: a browser keeps no client data on its disk (the firm's
 * decision, docs/offline-plan.md). Nothing here draws; a picture that was
 * never kept stays the initials the page already put there.
 *
 * Global: window.TMAOfflinePictures ({ keep, restore, key })
 */
(function () {
  'use strict';

  if (window.TMAOfflinePictures) return;
  if (!(window.TMADesktop && window.TMADesktop.isDesktop)) return;
  if (!window.caches || typeof window.caches.open !== 'function') return;

  var CACHE = 'tma-pictures-v1';
  var PICTURE_LIMIT = 600;
  var PICTURES = /^\/(media\/avatars\/|portal\/mail\/sender-photo\/|portal\/messaging\/conversations\/[^/]+\/photo|portal\/cip\/people\/[^/]+\/passport-photo|portal\/feed\/channels\/[^/]+\/image\/)/;

  // A document's thumbnail or preview: kept by the app's own file store, not
  // here (the desktop and Android answer it themselves; the iPhone is asked).
  var FILES = /^\/portal\/files\/files\/[a-f0-9-]{36}\/(preview|thumb)$/;
  var host = window.TMADesktop;

  var kept = Object.create(null); // url -> true once kept this session
  var opening = null;

  function cache() {
    if (!opening) {
      opening = window.caches.open(CACHE).catch(function () { opening = null; return null; });
    }
    return opening;
  }

  /* The portal's own picture addresses, as a key without the page's origin. */
  function pictureKey(src) {
    if (!src) return null;
    try {
      var url = new URL(src, location.href);
      if (url.origin !== location.origin || !PICTURES.test(url.pathname)) return null;
      return url.pathname + url.search;
    } catch (e) {
      return null;
    }
  }

  function trim(store) {
    return store.keys().then(function (keys) {
      var extra = keys.length - PICTURE_LIMIT;
      // Oldest first: the order they were put in.
      for (var i = 0; i < extra; i++) store.delete(keys[i]);
    }).catch(function () { /* next time */ });
  }

  /* Keep a picture that has just loaded. */
  function keep(key) {
    if (!key || kept[key]) return;
    kept[key] = true;
    cache().then(function (store) {
      if (!store) return null;
      return store.match(key).then(function (hit) {
        if (hit) return null;
        // From the browser's own cache where it can: the picture is on screen.
        return fetch(key, { credentials: 'same-origin', cache: 'force-cache' }).then(function (res) {
          var type = res.headers.get('content-type') || '';
          if (!res.ok || type.indexOf('image/') !== 0) return null;
          return store.put(key, res).then(function () { return trim(store); });
        });
      });
    }).catch(function () { delete kept[key]; });
  }

  /* Put a picture that could not load back from its copy. */
  function restore(img, key) {
    cache().then(function (store) {
      return store ? store.match(key) : null;
    }).then(function (hit) {
      return hit ? hit.blob() : null;
    }).then(function (blob) {
      if (!blob || !img.isConnected) return;
      img.setAttribute('data-tma-kept-picture', key);
      img.src = URL.createObjectURL(blob);
    }).catch(function () { /* the initials stay */ });
  }

  // Capture: load and error do not bubble, and this runs before an inline
  // onerror swaps in the initials (the address is read here, first).
  document.addEventListener('load', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || img.hasAttribute('data-tma-kept-picture')) return;
    keep(pictureKey(img.currentSrc || img.src));
  }, true);

  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || img.hasAttribute('data-tma-kept-picture')) return;
    var src = img.currentSrc || img.getAttribute('src');
    var file = fileKey(src);
    if (file) {
      if (typeof host.readKeptFile !== 'function') return;
      img.setAttribute('data-tma-kept-picture', file);
      host.readKeptFile(file).then(function (blob) {
        if (blob && img.isConnected) img.src = URL.createObjectURL(blob);
      });
      return;
    }
    var key = pictureKey(src);
    if (key) restore(img, key);
  }, true);

  function fileKey(src) {
    if (!src) return null;
    try {
      var url = new URL(src, location.href);
      return url.origin === location.origin && FILES.test(url.pathname) ? url.pathname : null;
    } catch (e) {
      return null;
    }
  }

  window.TMAOfflinePictures = { keep: keep, restore: restore, key: pictureKey };
})();
