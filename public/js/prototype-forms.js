/*
 * Prototype form guard - static auth/onboarding pages are not wired to a backend.
 *
 * With <base href="/">, action="#" resolves to / (not the current page), which
 * triggers Laravel MethodNotAllowedHttpException on POST. This script:
 *   1. Rewrites action="#" to the current pathname
 *   2. Blocks native submit on forms without data-demo (auth-flow.js owns those)
 */
(function () {
  "use strict";

  function pageAction() {
    var path = location.pathname || "/";
    return path.endsWith("/") ? path : path + "/";
  }

  function fixFormActions() {
    var action = pageAction();
    var forms = document.querySelectorAll('form[action="#"]');
    for (var i = 0; i < forms.length; i++) {
      forms[i].setAttribute("action", action);
    }
  }

  document.addEventListener("submit", function (ev) {
    var form = ev.target;
    if (!form || form.tagName !== "FORM") return;
    if (form.hasAttribute("data-demo")) return;
    ev.preventDefault();
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fixFormActions);
  } else {
    fixFormActions();
  }
})();
