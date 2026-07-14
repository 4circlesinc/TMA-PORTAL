/*
 * Auth flow - shared prototype behaviors for the public/auth/* screens.
 * Design prototype only: no real authentication happens here. Forms are
 * action="#" and every "submit" just moves the page between preview states.
 *
 * Contracts (data attributes):
 *   main[data-auth-flow][data-states="a b c"][data-state="a"]  page root
 *   [data-show="a b"]        visible only in the listed states
 *   [data-demo] form         prevented submit; optional data-loading-state,
 *                            data-submit-state, data-demo-href (delayed nav)
 *   [data-toggle-password]   show/hide the password in the same field
 *   [data-password-meter]    scores input into .tma-auth__strength + [data-req]
 *   [data-password-confirm]  live match check against the meter input
 *   [data-otp]               digit group: auto-advance, backspace, paste
 *   [data-countdown][data-seconds] resend timer; enables [data-resend]
 *   [data-copy]              copy data-copy-text or data-copy-target content
 *   [data-download-codes]    save .tma-auth__code list as a text file
 *   [data-print]             window.print()
 *   [data-gate]              checkbox enabling the selector it points at
 *   [data-captcha]           demo human-verification checkbox
 *   [data-dialog-open="#id"] / [data-dialog-close]  confirm dialogs
 *   [data-action="toggle-theme"]  light/dark toggle (tma.themeMode key)
 */
(function () {
  "use strict";

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  var root = document.querySelector("[data-auth-flow]");
  var docEl = document.documentElement;

  /* ── theme (shared keys with dashboard.js) ─────────────── */

  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function resolveTheme() {
    try {
      var q = new URL(window.location.href).searchParams.get("theme");
      if (q === "dark" || q === "light") return q;
    } catch (e) {}
    var mode = store.get("tma.themeMode", "");
    if (mode === "dark" || mode === "light") return mode;
    if (mode === "system") return systemDark.matches ? "dark" : "light";
    var legacy = store.get("tma.theme", "");
    if (legacy === "dark" || legacy === "light") return legacy;
    return systemDark.matches ? "dark" : "light";
  }

  function applyTheme(resolved) {
    if (resolved === "dark") docEl.setAttribute("data-theme", "dark");
    else docEl.removeAttribute("data-theme");
    /* dashboard dark styles are scoped to .tma-dash[data-theme="dark"] */
    var scope = document.querySelector("[data-theme-scope]");
    if (scope) {
      if (resolved === "dark") scope.setAttribute("data-theme", "dark");
      else scope.removeAttribute("data-theme");
    }
    var btn = document.querySelector('[data-action="toggle-theme"]');
    if (btn) {
      var img = btn.querySelector("img");
      if (img) {
        var src = img.getAttribute("src");
        var next = resolved === "dark" ? "MoonStars.svg" : "Sun.svg";
        img.setAttribute("src", src.replace(/(MoonStars|Sun)\.svg$/, next));
      }
      btn.setAttribute("aria-pressed", resolved === "dark" ? "true" : "false");
    }
  }

  function initTheme() {
    applyTheme(resolveTheme());
    var btn = document.querySelector('[data-action="toggle-theme"]');
    if (btn) {
      btn.addEventListener("click", function () {
        var next = docEl.getAttribute("data-theme") === "dark" ? "light" : "dark";
        store.set("tma.themeMode", next);
        store.set("tma.theme", next);
        applyTheme(next);
      });
    }
    systemDark.addEventListener("change", function () {
      if (store.get("tma.themeMode", "") === "system" || (!store.get("tma.themeMode", "") && !store.get("tma.theme", ""))) {
        applyTheme(resolveTheme());
      }
    });
  }

  /* ── state engine + preview panel ──────────────────────── */

  var announcer = null;

  function announce(text) {
    if (!announcer) {
      announcer = document.createElement("div");
      announcer.setAttribute("aria-live", "polite");
      announcer.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
      document.body.appendChild(announcer);
    }
    announcer.textContent = text;
  }

  function humanize(s) {
    s = String(s).replace(/-/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function currentStates() {
    if (!root) return [];
    return (root.getAttribute("data-states") || "").split(/\s+/).filter(Boolean);
  }

  function setState(state, opts) {
    if (!root) return;
    root.setAttribute("data-state", state);
    var nodes = root.querySelectorAll("[data-show]");
    for (var i = 0; i < nodes.length; i++) {
      var list = nodes[i].getAttribute("data-show").split(/\s+/);
      nodes[i].hidden = list.indexOf(state) === -1;
    }
    var select = document.querySelector("[data-preview-select]");
    if (select && select.value !== state) select.value = state;
    if (!opts || !opts.silent) {
      try {
        var url = new URL(window.location.href);
        url.searchParams.set("state", state);
        history.replaceState(null, "", url.toString());
      } catch (e) {}
      announce(humanize(state) + " state");
    }
    restartCountdowns();
    var focus = root.querySelector('[data-autofocus="' + state + '"]');
    if (focus) focus.focus();
  }

  function buildPreviewPanel() {
    var states = currentStates();
    if (!states.length) return;
    var panel = document.createElement("aside");
    panel.className = "tma-preview";
    panel.setAttribute("aria-label", "Design preview controls");

    var row = document.createElement("div");
    row.className = "tma-preview__row";
    var label = document.createElement("label");
    label.textContent = "Preview state";
    var select = document.createElement("select");
    select.setAttribute("data-preview-select", "");
    for (var i = 0; i < states.length; i++) {
      var opt = document.createElement("option");
      opt.value = states[i];
      opt.textContent = humanize(states[i]);
      select.appendChild(opt);
    }
    label.appendChild(select);
    row.appendChild(label);
    panel.appendChild(row);

    var nav = document.createElement("div");
    nav.className = "tma-preview__row";
    var back = document.createElement("a");
    back.href = "/design/auth";
    back.textContent = "All screens";
    nav.appendChild(back);
    var nextHref = root.getAttribute("data-demo-next");
    if (nextHref) {
      var next = document.createElement("a");
      next.href = nextHref;
      next.textContent = "Next screen";
      nav.appendChild(next);
    }
    panel.appendChild(nav);

    select.addEventListener("change", function () { setState(select.value); });
    document.body.appendChild(panel);
  }

  function initState() {
    if (!root) return;
    buildPreviewPanel();
    var states = currentStates();
    var initial = root.getAttribute("data-state") || states[0];
    try {
      var q = new URL(window.location.href).searchParams.get("state");
      if (q && states.indexOf(q) !== -1) initial = q;
    } catch (e) {}
    if (initial) setState(initial, { silent: true });
  }

  function initStateButtons() {
    var btns = document.querySelectorAll("[data-set-state]");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function (ev) {
          if (btn.tagName === "A") ev.preventDefault();
          setState(btn.getAttribute("data-set-state"));
        });
      })(btns[i]);
    }
  }

  /* ── demo form submits ─────────────────────────────────── */

  function initForms() {
    var forms = document.querySelectorAll("form[data-demo]");
    for (var i = 0; i < forms.length; i++) {
      (function (form) {
        form.addEventListener("submit", function (ev) {
          ev.preventDefault();
          var loading = form.getAttribute("data-loading-state");
          var target = form.getAttribute("data-submit-state");
          var href = form.getAttribute("data-demo-href");
          function finish() {
            if (href) { window.location.href = href; return; }
            if (target) setState(target);
          }
          if (loading) {
            setState(loading);
            window.setTimeout(finish, 900);
          } else {
            finish();
          }
        });
      })(forms[i]);
    }
  }

  /* ── password show/hide ────────────────────────────────── */

  function initPasswordToggles() {
    var btns = document.querySelectorAll("[data-toggle-password]");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var field = btn.closest(".tma-auth__field");
          var input = field && field.querySelector("input");
          if (!input) return;
          var show = input.type === "password";
          input.type = show ? "text" : "password";
          btn.setAttribute("aria-pressed", show ? "true" : "false");
          var img = btn.querySelector("img");
          if (img) {
            var src = img.getAttribute("src");
            img.setAttribute("src", show ? src.replace("EyeSlash.svg", "Eye.svg") : src.replace(/\/Eye\.svg$/, "/EyeSlash.svg"));
          }
          input.focus();
        });
      })(btns[i]);
    }
  }

  /* ── password strength + requirements + confirm ────────── */

  function initPasswordMeter() {
    var input = document.querySelector("[data-password-meter]");
    if (!input) return;
    var scope = input.closest("form") || root || document;
    var segs = scope.querySelectorAll(".tma-auth__strength-seg");
    var reqs = scope.querySelectorAll("[data-req]");
    var confirm = scope.querySelector("[data-password-confirm]");
    var mismatch = scope.querySelector("[data-mismatch-msg]");

    var checks = {
      length: function (v) { return v.length >= 10; },
      "case": function (v) { return /[a-z]/.test(v) && /[A-Z]/.test(v); },
      number: function (v) { return /[0-9]/.test(v); },
      symbol: function (v) { return /[^A-Za-z0-9]/.test(v); }
    };

    function score() {
      var v = input.value;
      var met = 0;
      for (var i = 0; i < reqs.length; i++) {
        var kind = reqs[i].getAttribute("data-req");
        var ok = checks[kind] ? checks[kind](v) : false;
        reqs[i].setAttribute("data-met", ok ? "true" : "false");
        if (ok) met++;
      }
      if (!reqs.length) {
        for (var k in checks) if (checks[k](input.value)) met++;
      }
      for (var s = 0; s < segs.length; s++) {
        segs[s].classList.toggle("tma-auth__strength-seg--active", s < met && v.length > 0);
      }
      matchCheck();
    }

    function matchCheck() {
      if (!confirm) return;
      var bad = confirm.value.length > 0 && confirm.value !== input.value;
      var field = confirm.closest(".tma-auth__field");
      if (field) field.classList.toggle("tma-auth__field--error", bad);
      if (mismatch) mismatch.hidden = !bad;
    }

    input.addEventListener("input", score);
    if (confirm) confirm.addEventListener("input", matchCheck);
    score();
  }

  /* ── OTP digit groups ──────────────────────────────────── */

  function initOtp() {
    var groups = document.querySelectorAll("[data-otp]");
    for (var g = 0; g < groups.length; g++) {
      (function (group) {
        var digits = group.querySelectorAll(".tma-auth__otp-digit");
        function at(i) { return i >= 0 && i < digits.length ? digits[i] : null; }
        for (var i = 0; i < digits.length; i++) {
          (function (input, i) {
            input.addEventListener("input", function () {
              input.value = input.value.replace(/\D/g, "").slice(-1);
              if (input.value && at(i + 1)) at(i + 1).focus();
            });
            input.addEventListener("keydown", function (ev) {
              if (ev.key === "Backspace" && !input.value && at(i - 1)) { at(i - 1).focus(); }
              if (ev.key === "ArrowLeft" && at(i - 1)) { ev.preventDefault(); at(i - 1).focus(); }
              if (ev.key === "ArrowRight" && at(i + 1)) { ev.preventDefault(); at(i + 1).focus(); }
            });
            input.addEventListener("paste", function (ev) {
              var text = (ev.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
              if (!text) return;
              ev.preventDefault();
              for (var d = 0; d < digits.length - i && d < text.length; d++) {
                digits[i + d].value = text.charAt(d);
              }
              var last = Math.min(i + text.length, digits.length) - 1;
              if (at(last)) at(last).focus();
            });
          })(digits[i], i);
        }
      })(groups[g]);
    }
  }

  /* ── resend countdowns ─────────────────────────────────── */

  var timers = [];

  function startCountdown(el) {
    var seconds = parseInt(el.getAttribute("data-seconds"), 10) || 60;
    var num = el.querySelector("[data-countdown-num]");
    var scope = el.closest("[data-show]") || document;
    var resend = scope.querySelector("[data-resend]") || document.querySelector("[data-resend]");
    var left = seconds;
    el.hidden = false;
    if (resend) resend.disabled = true;
    function tick() {
      if (num) num.textContent = String(left);
      if (left <= 0) {
        el.hidden = true;
        if (resend) resend.disabled = false;
        return;
      }
      left--;
      timers.push(window.setTimeout(tick, 1000));
    }
    tick();
  }

  function restartCountdowns() {
    for (var i = 0; i < timers.length; i++) window.clearTimeout(timers[i]);
    timers = [];
    var resends = document.querySelectorAll("[data-resend]");
    for (var r = 0; r < resends.length; r++) resends[r].disabled = false;
    var els = document.querySelectorAll("[data-countdown]");
    for (var e = 0; e < els.length; e++) {
      var visible = !els[e].closest("[hidden]");
      if (visible) startCountdown(els[e]);
    }
  }

  function initResend() {
    var btns = document.querySelectorAll("[data-resend]");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var target = btn.getAttribute("data-resend-state");
          if (target) setState(target);
          else restartCountdowns();
        });
      })(btns[i]);
    }
  }

  /* ── copy / download / print ───────────────────────────── */

  function copyText(text, btn) {
    function done() {
      btn.setAttribute("data-copied", "true");
      var span = btn.querySelector("span");
      var prev = span ? span.textContent : "";
      if (span) span.textContent = "Copied";
      window.setTimeout(function () {
        btn.removeAttribute("data-copied");
        if (span) span.textContent = prev;
      }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else { done(); }
  }

  function initCopy() {
    var btns = document.querySelectorAll("[data-copy]");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var text = btn.getAttribute("data-copy-text") || "";
          var sel = btn.getAttribute("data-copy-target");
          if (sel) {
            var nodes = document.querySelectorAll(sel);
            var parts = [];
            for (var n = 0; n < nodes.length; n++) parts.push(nodes[n].textContent.trim());
            text = parts.join("\n");
          }
          copyText(text, btn);
        });
      })(btns[i]);
    }
    var dl = document.querySelector("[data-download-codes]");
    if (dl) {
      dl.addEventListener("click", function () {
        var nodes = document.querySelectorAll(".tma-auth__code");
        var lines = ["TM ANTOINE Advisory - recovery codes", "Each code can be used once. Store securely.", ""];
        for (var n = 0; n < nodes.length; n++) lines.push(nodes[n].textContent.trim());
        var blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "tma-recovery-codes.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      });
    }
    var pr = document.querySelector("[data-print]");
    if (pr) pr.addEventListener("click", function () { window.print(); });
  }

  /* ── checkbox gates ────────────────────────────────────── */

  function initGates() {
    var boxes = document.querySelectorAll("[data-gate]");
    for (var i = 0; i < boxes.length; i++) {
      (function (box) {
        var target = document.querySelector(box.getAttribute("data-gate"));
        if (!target) return;
        function sync() {
          if (target.tagName === "A") target.setAttribute("aria-disabled", box.checked ? "false" : "true");
          else target.disabled = !box.checked;
        }
        box.addEventListener("change", sync);
        sync();
      })(boxes[i]);
    }
  }

  /* ── demo captcha ──────────────────────────────────────── */

  function initCaptcha() {
    var widgets = document.querySelectorAll("[data-captcha]");
    for (var i = 0; i < widgets.length; i++) {
      (function (w) {
        var box = w.querySelector(".tma-auth__captcha-box");
        if (!box) return;
        box.addEventListener("click", function () {
          var on = w.getAttribute("data-checked") === "true";
          w.setAttribute("data-checked", on ? "false" : "true");
          box.setAttribute("aria-checked", on ? "false" : "true");
        });
      })(widgets[i]);
    }
  }

  /* ── dialogs ───────────────────────────────────────────── */

  function initDialogs() {
    var openers = document.querySelectorAll("[data-dialog-open]");
    for (var i = 0; i < openers.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var dlg = document.querySelector(btn.getAttribute("data-dialog-open"));
          if (dlg) {
            dlg.hidden = false;
            var first = dlg.querySelector("button, a, input");
            if (first) first.focus();
          }
        });
      })(openers[i]);
    }
    var closers = document.querySelectorAll("[data-dialog-close]");
    for (var c = 0; c < closers.length; c++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var dlg = btn.closest(".tma-auth__dialog");
          if (dlg) dlg.hidden = true;
        });
      })(closers[c]);
    }
    var dialogs = document.querySelectorAll(".tma-auth__dialog");
    for (var d = 0; d < dialogs.length; d++) {
      (function (dlg) {
        dlg.addEventListener("click", function (ev) {
          if (ev.target === dlg) dlg.hidden = true;
        });
      })(dialogs[d]);
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      var open = document.querySelector(".tma-auth__dialog:not([hidden])");
      if (open) open.hidden = true;
    });
  }

  /* ── boot ──────────────────────────────────────────────── */

  function fixPrototypeFormActions() {
    var path = location.pathname || "/";
    if (!path.endsWith("/")) path += "/";
    var forms = document.querySelectorAll('form[action="#"]');
    for (var i = 0; i < forms.length; i++) forms[i].setAttribute("action", path);
  }

  fixPrototypeFormActions();
  initTheme();
  initState();
  initStateButtons();
  initForms();
  initPasswordToggles();
  initPasswordMeter();
  initOtp();
  initResend();
  initCopy();
  initGates();
  initCaptcha();
  initDialogs();
  restartCountdowns();
})();
