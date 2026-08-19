/**
 * TMA - Overview → Employees tab
 * Staff presence (online/offline) + today's work-plan status.
 * Global: window.TMAOverviewEmployees
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function avatarSrc(person) {
    if (window.TMACurrentUser && window.TMACurrentUser.avatarSrc) {
      return window.TMACurrentUser.avatarSrc(person.avatar, person.name);
    }
    return person.avatar || 'images/avatars/Avatar3d01.png';
  }

  /* Presence chips are Online / Offline only — same as portal-home.js. */
  function presenceTone(p) {
    if (p.statusLabel) return p.status === 'offline' ? 'offline' : 'online';
    return p.online ? 'online' : 'offline';
  }

  function lastSeen(p) {
    if (window.TMAPresence && (p.statusLabel || p.status)) {
      return window.TMAPresence.labelFor(p);
    }
    if (window.TMALastSeen) return window.TMALastSeen.forPresence(p);
    return p.online ? 'Online' : (p.lastSeen || 'Last seen recently');
  }

  function subtitle(p) {
    return lastSeen(p);
  }

  function renderRow(p) {
    var work = p.workStatus || null;
    var tone = presenceTone(p);
    var badgeLabel = p.statusLabel || (p.online ? 'Online' : 'Offline');
    var workLabel = work && work.label ? work.label : '';
    return '<div class="tma-dash__overview-employee" data-employee-id="' + esc(p.id) + '">' +
      '<span class="tma-portal-employee__avatar' + (p.online ? ' is-online' : ' is-offline') + '">' +
      '<img src="' + esc(avatarSrc(p)) + '" alt="" width="40" height="40" loading="lazy">' +
      '</span>' +
      '<span class="tma-dash__overview-employee__meta">' +
      '<span class="tma-dash__overview-employee__name">' + esc(p.name) + (p.self ? ' (you)' : '') + '</span>' +
      '<span class="tma-dash__overview-employee__sub">' + esc(subtitle(p)) + '</span>' +
      (p.jobTitle ? '<span class="tma-dash__overview-employee__role">' + esc(p.jobTitle) + '</span>' : '') +
      '</span>' +
      '<span class="tma-dash__overview-employee__status">' +
      '<span class="tma-portal-employee__badge tma-portal-employee__badge--' + tone + '">' +
      esc(badgeLabel) +
      '</span>' +
      '<span class="tma-dash__overview-employee__work">' + esc(workLabel) + '</span>' +
      '</span></div>';
  }

  function mount(container) {
    if (!container || container.hasAttribute('data-employees-mounted')) return;
    container.setAttribute('data-employees-mounted', '');

    var state = { loaded: false, staff: true, employees: [] };

    function paint() {
      if (!state.loaded) {
        container.innerHTML =
          '<div class="tma-dash__overview-employees tma-dash__overview-employees--loading" aria-busy="true">' +
          new Array(6).fill(
            '<div class="tma-dash__overview-employee tma-dash__overview-employee--skeleton">' +
            '<span class="tma-skeleton tma-skeleton--avatar" style="width:40px;height:40px;border-radius:50%"></span>' +
            '<span style="flex:1;min-width:0">' +
            '<span class="tma-skeleton tma-skeleton--text" style="width:42%"></span>' +
            '<span class="tma-skeleton tma-skeleton--text" style="width:28%;margin-top:8px;display:block"></span>' +
            '</span></div>'
          ).join('') +
          '</div>';
        return;
      }

      if (!state.staff) {
        container.innerHTML = window.TMANoData
          ? window.TMANoData.render({
              illustrationName: 'Illustration14',
              title: 'Employees are for staff',
              subtitle: 'This board shows who’s online and their work status.',
              showButton: false,
            })
          : '<p class="tma-dash__overview-empty">Employees are only available to staff accounts.</p>';
        return;
      }

      var people = state.employees || [];
      var online = people.filter(function (p) { return p.online; }).length;

      if (!people.length) {
        container.innerHTML = window.TMANoData
          ? window.TMANoData.render({
              illustrationName: 'Illustration14',
              title: 'No employees yet',
              subtitle: 'Approved staff accounts will show up here with presence and work status.',
              showButton: false,
            })
          : '<p class="tma-dash__overview-empty">No employees yet.</p>';
        return;
      }

      container.innerHTML =
        '<div class="tma-dash__overview-employees">' +
        '<div class="tma-dash__overview-employees__head">' +
        '<h3 class="tma-dash__overview-employees__title">Team</h3>' +
        '<span class="tma-dash__overview-employees__meta">' + online + ' of ' + people.length + ' online</span>' +
        '</div>' +
        '<div class="tma-dash__overview-employees__list">' +
        people.map(renderRow).join('') +
        '</div></div>';
    }

    function reload() {
      paint();
      fetch(ROOT + '/portal/dashboard/staff', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          state.loaded = true;
          if (!j || j.staff === false) {
            state.staff = false;
            state.employees = [];
          } else {
            state.staff = true;
            state.employees = j.employees || [];
          }
          paint();
        })
        .catch(function () {
          state.loaded = true;
          state.staff = true;
          state.employees = [];
          paint();
        });
    }

    reload();

    document.addEventListener('tma:presence-status', function (ev) {
      var p = ev.detail;
      if (!p || !state.employees) return;
      var changed = false;
      state.employees = state.employees.map(function (person) {
        if (person.id !== p.userId) return person;
        changed = true;
        if (window.TMAPresence && window.TMAPresence.applyRemoteToPerson) {
          return window.TMAPresence.applyRemoteToPerson(person, p);
        }
        person.online = p.status !== 'offline';
        person.statusLabel = p.label;
        return person;
      });
      if (changed) paint();
    });

    // Soft refresh while the tab stays open.
    var timer = setInterval(function () {
      if (!container.isConnected) {
        clearInterval(timer);
        return;
      }
      reload();
    }, 45000);
  }

  window.TMAOverviewEmployees = { mount: mount };
})();
