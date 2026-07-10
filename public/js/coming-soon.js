/*
 * Coming Soon — live countdown (32546:96131)
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-countdown]');
  if (!root) return;

  var hoursEl = root.querySelector('[data-hours]');
  var minutesEl = root.querySelector('[data-minutes]');
  var secondsEl = root.querySelector('[data-seconds]');
  if (!hoursEl || !minutesEl || !secondsEl) return;

  var launchAt = root.getAttribute('data-launch-at');
  var target = launchAt ? new Date(launchAt).getTime() : NaN;
  if (Number.isNaN(target)) return;

  function tick() {
    var diff = Math.max(0, target - Date.now());
    var hours = Math.floor(diff / 3600000);
    var minutes = Math.floor((diff % 3600000) / 60000);
    var seconds = Math.floor((diff % 60000) / 1000);

    hoursEl.textContent = String(hours);
    minutesEl.textContent = String(minutes);
    secondsEl.textContent = String(seconds);
  }

  tick();
  setInterval(tick, 1000);
})();
