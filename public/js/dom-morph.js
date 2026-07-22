/*
 * TMAMorph — keyed DOM reconciliation.
 *
 * Why this exists
 * ---------------
 * Every portal view renders by building an HTML string and assigning it:
 *
 *     root.innerHTML = renderLayout(state);
 *
 * That is correct but destructive. The browser throws away every existing node
 * and builds new ones, which means on *every* state change — a delivery tick,
 * a reaction, a folder colour — the portal:
 *
 *   - destroys and recreates every <img>, so avatars and thumbnails re-request
 *     and visibly flash even though their src never changed;
 *   - loses scroll position on every scrollable pane;
 *   - loses focus, selection and IME state in the composer;
 *   - restarts CSS transitions and animations;
 *   - drops :hover, and collapses any open <details>.
 *
 * patch() takes the same HTML string and instead *updates the existing tree to
 * match it*, reusing nodes wherever it can. Nodes that did not change are not
 * touched at all, so images stay loaded, scroll stays put, and typing survives.
 *
 * Keying
 * ------
 * List items are matched by key, not by position, so inserting a message at the
 * top of a thread moves one node instead of rewriting every row beneath it. A
 * node's key is the first of:
 *
 *   1. data-key            explicit, wins over everything
 *   2. data-*-id           e.g. data-messages-id, data-file-id
 *   3. data-*-row          e.g. data-messages-row
 *   4. id
 *
 * The portal's existing markup already carries these (data-messages-id on
 * bubbles, data-messages-row on conversation rows), so keying works without
 * touching the render functions.
 *
 * Escape hatches
 * --------------
 *   data-morph-skip      leave this element's subtree entirely alone. For
 *                        third-party or self-managing widgets (maps, editors).
 *   data-morph-replace   never reuse this element; always rebuild it.
 */
(function () {
  'use strict';

  /* Attributes that describe live user state rather than rendered output.
   * Copying these from the freshly-rendered string would clobber what the user
   * is currently doing, so they are synced only when the element is not the one
   * being interacted with. */
  var VALUE_TAGS = { INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1 };

  function keyOf(el) {
    if (!el.getAttribute) return null;

    var k = el.getAttribute('data-key');
    if (k) return 'k:' + k;

    // Any data-*-id / data-*-row attribute already present in the markup.
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name;
      if (name.indexOf('data-') !== 0) continue;
      if (name.slice(-3) !== '-id' && name.slice(-4) !== '-row') continue;

      /*
       * A valueless marker attribute is not an identity.
       *
       * File cards carry `data-files-row data-id="7"` — the bare marker comes
       * first, and treating it as the key gave every card in the grid the same
       * empty key. Only the first could then be matched; every other card was
       * rebuilt on each render, re-fetching its thumbnail. Skipping empty
       * values here lets the real id further along the list win.
       */
      if (!attrs[i].value) continue;

      // Namespaced by attribute name so a file id and a message id sharing the
      // numeric value 7 are never treated as the same node.
      return name + ':' + attrs[i].value;
    }

    if (el.id) return '#' + el.id;
    return null;
  }

  /*
   * The set of data-* attribute *names* on an element, which is what the views
   * use to say what a node is for: data-messages-compose, data-messages-row,
   * data-home-file. Values are ignored — only the roles matter.
   */
  function roleSignature(el) {
    var attrs = el.attributes;
    var names = [];
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name;
      if (name.indexOf('data-') !== 0) continue;
      if (name.indexOf('data-morph-') === 0) continue;
      names.push(name);
    }
    return names.sort().join(',');
  }

  /*
   * Two nodes can be reconciled if they are the same kind of thing.
   *
   * Tag is the obvious part. The role signature is the subtle one: an element
   * must never be reused as an element with a *different* purpose. Views bind
   * listeners by data attribute and those listeners cannot be taken off again,
   * so repurposing one button as another leaves the first handler attached and
   * the node fires both. That is not hypothetical — the "new message" button
   * was silently reused as the "chats" nav button, so opening the compose panel
   * also ran the nav handler and closed it again.
   *
   * Rebuilding in that case is no worse than the innerHTML behaviour it
   * replaces, and it keeps node reuse confined to nodes that mean the same
   * thing render over render.
   */
  function compatible(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    if (a.tagName !== b.tagName) return false;
    if (a.hasAttribute('data-morph-replace')) return false;
    if (roleSignature(a) !== roleSignature(b)) return false;
    return true;
  }

  function syncAttributes(oldEl, newEl) {
    var oldAttrs = oldEl.attributes;
    var newAttrs = newEl.attributes;
    var i, attr, name, value;

    // Apply everything the new markup specifies, but only where it differs —
    // writing an identical value still invalidates style/layout in some engines,
    // and on <img src> it can restart the request.
    for (i = 0; i < newAttrs.length; i++) {
      attr = newAttrs[i];
      name = attr.name;
      value = attr.value;

      if (oldEl.getAttribute(name) !== value) {
        oldEl.setAttribute(name, value);
      }
    }

    // Remove attributes that are no longer present.
    for (i = oldAttrs.length - 1; i >= 0; i--) {
      name = oldAttrs[i].name;
      // Internal bookkeeping, not rendered output.
      if (name.indexOf('data-morph-') === 0) continue;
      if (!newEl.hasAttribute(name)) oldEl.removeAttribute(name);
    }
  }

  /*
   * Form controls keep a live value in the DOM property, separate from the
   * attribute. Re-rendering must not yank text out from under someone mid-type,
   * so the focused control keeps whatever the user has entered; unfocused ones
   * follow the rendered value.
   */
  function syncFormState(oldEl, newEl) {
    if (!VALUE_TAGS[oldEl.tagName]) return;

    var active = document.activeElement === oldEl;

    if (oldEl.tagName === 'INPUT' || oldEl.tagName === 'TEXTAREA') {
      var nextValue = newEl.hasAttribute('value')
        ? newEl.getAttribute('value')
        : newEl.value;

      if (!active && nextValue !== undefined && oldEl.value !== nextValue) {
        oldEl.value = nextValue;
      }

      // Checkedness is rendered state and safe to follow even while focused,
      // because a click has already updated the property before we re-render.
      if (oldEl.type === 'checkbox' || oldEl.type === 'radio') {
        oldEl.checked = newEl.hasAttribute('checked');
      }
    }

    if (oldEl.tagName === 'OPTION') {
      oldEl.selected = newEl.hasAttribute('selected');
    }
  }

  /*
   * Images are the main reason this library exists. Reassigning src — even the
   * same string — can drop a decoded frame and re-hit the network, which is the
   * visible "avatar keeps loading" flicker. syncAttributes already skips
   * identical values; this additionally protects an image that has finished
   * loading from being reset by an equivalent-but-not-identical URL.
   */
  function sameImage(oldEl, newEl) {
    if (oldEl.tagName !== 'IMG') return false;
    var a = oldEl.getAttribute('src');
    var b = newEl.getAttribute('src');
    if (a === b) return true;
    // Resolved comparison catches relative vs absolute forms of one URL.
    return !!a && !!b && oldEl.src === new URL(b, document.baseURI).href;
  }

  function morphElement(oldEl, newEl) {
    if (oldEl.hasAttribute('data-morph-skip')) return;

    var imageHeld = sameImage(oldEl, newEl);
    var heldSrc = imageHeld ? oldEl.getAttribute('src') : null;

    syncAttributes(oldEl, newEl);

    // Put the original src back if the two forms were equivalent, so a loaded
    // image is never asked to fetch itself again.
    if (imageHeld && oldEl.getAttribute('src') !== heldSrc) {
      oldEl.setAttribute('src', heldSrc);
    }

    syncFormState(oldEl, newEl);
    morphChildren(oldEl, newEl);
  }

  function morphChildren(oldParent, newParent) {
    var oldChildren = oldParent.childNodes;
    var newChildren = newParent.childNodes;

    // Index the reusable keyed children up front so a reorder is a move rather
    // than a rebuild.
    var keyed = null;
    var i, node, key;
    for (i = 0; i < oldChildren.length; i++) {
      node = oldChildren[i];
      if (node.nodeType !== 1) continue;
      key = keyOf(node);
      if (!key) continue;
      if (!keyed) keyed = {};
      // First occurrence wins; duplicate keys are a render bug, and reusing the
      // first is stable rather than arbitrary.
      if (!(key in keyed)) keyed[key] = node;
    }

    var cursor = oldParent.firstChild;

    for (i = 0; i < newChildren.length; i++) {
      var wanted = newChildren[i];
      var match = null;

      key = wanted.nodeType === 1 ? keyOf(wanted) : null;

      if (key && keyed && keyed[key] && compatible(keyed[key], wanted)) {
        // Keyed reuse: this exact node exists somewhere in the old tree.
        match = keyed[key];
        delete keyed[key];
      } else if (!key && cursor && compatible(cursor, wanted) && !keyOf(cursor)) {
        // Unkeyed positional reuse. Only against an unkeyed neighbour — a keyed
        // node belongs to a specific record and must not be repurposed.
        match = cursor;
      }

      if (match) {
        if (match !== cursor) {
          // Reorder: move the existing node (and its loaded images, and its
          // listeners) into place rather than recreating it.
          oldParent.insertBefore(match, cursor);
        } else {
          cursor = cursor.nextSibling;
        }

        if (match.nodeType === 1) {
          morphElement(match, wanted);
        } else if (match.nodeValue !== wanted.nodeValue) {
          match.nodeValue = wanted.nodeValue;
        }
      } else {
        // Genuinely new content.
        oldParent.insertBefore(wanted.cloneNode(true), cursor);
      }
    }

    // Anything still unclaimed is gone from the new render.
    while (cursor) {
      var next = cursor.nextSibling;
      oldParent.removeChild(cursor);
      cursor = next;
    }
    if (keyed) {
      for (key in keyed) {
        if (!Object.prototype.hasOwnProperty.call(keyed, key)) continue;
        if (keyed[key].parentNode === oldParent) oldParent.removeChild(keyed[key]);
      }
    }
  }

  /*
   * Update `root`'s children to match `html`.
   *
   * Drop-in replacement for `root.innerHTML = html`. The rendered string is
   * parsed against a container of the same tag so table sections and list items
   * parse correctly rather than being silently discarded.
   */
  function patch(root, html) {
    if (!root) return;

    // No existing content: the destructive path is also the correct one, and
    // skips a pointless diff on first paint.
    if (!root.firstChild) {
      root.innerHTML = html;
      return;
    }

    var staging = document.createElement(root.tagName);
    staging.innerHTML = html;

    morphChildren(root, staging);
  }

  /*
   * Idempotent listener wiring.
   *
   * The views bind listeners by walking the DOM after each render
   * (`root.querySelectorAll(sel).forEach(el => el.addEventListener(...))`).
   * That was safe only because innerHTML had just destroyed every old node.
   * Now that patch() *preserves* nodes, re-running that wiring would stack a
   * second, third, nth listener on the same element and fire one click many
   * times.
   *
   * unwired() returns only the elements that have not already been wired for
   * this selector, so the existing wiring code stays exactly as it is and
   * simply becomes a no-op for surviving nodes.
   *
   * Handlers must therefore close over values that stay valid for the life of
   * the node — the views' `state` and `render` are created once per mount, so
   * they do. Anything per-render must be read from the DOM at event time
   * (which the existing handlers already do via getAttribute).
   */
  function unwired(root, selector, tag) {
    // `tag` separates two independent bindings over the same selector — the
    // conversation rows take both a click and a contextmenu handler, and
    // without it the second walk would find every row already flagged by the
    // first and bind nothing at all.
    var flag = '__tmaWired:' + selector + (tag ? '#' + tag : '');
    var out = [];

    root.querySelectorAll(selector).forEach(function (el) {
      if (el[flag]) return;
      el[flag] = true;
      out.push(el);
    });

    // The root itself can carry a delegated binding.
    if (root.matches && root.matches(selector) && !root[flag]) {
      root[flag] = true;
      out.push(root);
    }

    return out;
  }

  /*
   * Idempotent binding for a single element.
   *
   * The counterpart to unwired() for the `var btn = root.querySelector(...)`
   * shape, where the element is often used for more than binding and so cannot
   * simply be filtered out of the lookup.
   *
   * `tag` distinguishes two different handlers of the same type on one element;
   * it is only needed when that actually happens.
   */
  function on(el, type, handler, tag) {
    if (!el) return false;

    var flag = '__tmaOn:' + type + ':' + (tag || '');
    if (el[flag]) return false;
    el[flag] = true;

    el.addEventListener(type, handler);
    return true;
  }

  /*
   * unwired() for a single expected element.
   *
   * Returns the matching element the first time it is asked for, and null on
   * every later render while that same element survives — so the common
   *
   *     var btn = TMAMorph.unwiredOne(root, '[data-x]');
   *     if (btn) btn.addEventListener('click', …);
   *
   * shape binds once per element rather than once per render. Callers that need
   * the element for anything besides binding must use querySelector instead.
   */
  function unwiredOne(root, selector, tag) {
    return unwired(root, selector, tag)[0] || null;
  }

  window.TMAMorph = {
    patch: patch,
    unwired: unwired,
    unwiredOne: unwiredOne,
    on: on,
    keyOf: keyOf,
  };
})();
