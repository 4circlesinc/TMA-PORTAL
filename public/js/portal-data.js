/*
 * TMA - Client portal shared data store
 * localStorage-backed state for the client-portal feature set
 * (dashboard, folders, projects, workflows, templates, signatures,
 * inbox, people, account settings). Seeded from the trial-environment
 * replication brief; all portal-* page modules read and write here.
 * Global: window.TMAPortalData
 */
(function () {
  'use strict';

  var KEY = 'tma.portal.v1';
  var DELETED_RETENTION_DAYS = 45;
  var FILEBOX_RETENTION_DAYS = 180;

  /* Removed settings pages, listed so load() can clear what they left behind.
     Super user group and quarantine duplicated or invented things the portal
     does not do; File Drops, Remote Upload Forms, File Settings, Portal Tools,
     AI and Email Settings described a product this is not. */
  var RETIRED_KEYS = ['superUsers', 'hideSuperGroup', 'quarantinedFiles', 'fileDrops', 'remoteUploadForms', 'folderTemplates', 'serviceTeams', 'customFields'];
  var RETIRED_SETTINGS = [
    'dlp', 'emailSettings', 'fileSettings', 'tools', 'ai', 'permissions',
    // Rebuilt server-backed rather than removed, the stale copy would just
    // sit there disagreeing with the real one.
    'deviceSecurity', 'securityPolicy', 'signInPolicy', 'alertSettings',
  ];

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function shortDate(d) {
    d = d || new Date();
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear();
  }

  function dateTime(d) {
    d = d || new Date();
    var h = d.getHours();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return shortDate(d) + ' ' + h + ':' + pad(d.getMinutes()) + ampm;
  }

  var FAKE_PERSONAL_NAMES = {
    'Project_Brief.pdf': 1,
    'Client_Onboarding_Template.docx': 1,
    Test: 1,
  };

  function isSeededFakeFolderItem(item) {
    if (!item) return false;
    if (item.id === 'folder-test' || item.id === 'file-seed-1' || item.id === 'file-seed-2') return true;
    return !!FAKE_PERSONAL_NAMES[item.name];
  }

  function isSeededFakeEmployee(emp) {
    if (!emp) return false;
    if (emp.id === 'emp-1') return true;
    var full = [emp.firstName, emp.lastName].filter(Boolean).join(' ');
    return full === 'Travis Francis';
  }

  function seed() {
    return {
      user: {
        firstName: '',
        lastName: '',
        name: '',
        email: '',
        company: '',
      },
      trial: {
        active: true,
        daysLeft: 2,
        signatureLimit: 5,
        signatureUsed: 0,
        employeeLimit: 3,
      },
      branding: {
        accountName: '',
        pageTitle: '',
        logoName: '',
        headerColor: '#FFFFFF',
        accentColor: '#0C0C0C',
      },
      dashboardTiles: {
        recentFiles: true,
        shortcuts: true,
        favorites: true,
        employees: true,
        email: true,
        road: true,
      },
      dashboardWorkflowStrip: true,
      // Default admin home board order. Unknown ids are appended.
      dashboardTileOrder: ['recentFiles', 'email', 'cipStatus', 'favorites', 'road', 'shortcuts', 'employees', 'messages'],
      // Legacy size map, unused after the fixed 2-column grid; kept empty for older caches.
      dashboardTileSizes: {},
      // Populated from the File Library (section=recent) on the dashboard mount;
      // starts empty so no placeholder filenames flash before the real data.
      recentFiles: [],
      folders: {
        personal: [],
        shared: [],
        favorites: [],
        recycle: [],
      },
      projects: [],
      templates: [
        { id: 'tpl-1', name: 'Client Onboarding', category: 'Accounting', kind: 'Project', description: 'Collect and organize files, to-dos, and handoffs to get client setup quickly.' },
        { id: 'tpl-2', name: 'Due Diligence Essentials', category: 'Finance', kind: 'Project', description: 'Get ready for audits and reviews with every document in one, shared workspace.' },
        { id: 'tpl-3', name: 'Enhanced project experience', category: 'Legal', kind: 'Project', description: 'A richer workspace with tasks, files, and messaging in one place.' },
        { id: 'tpl-4', name: 'HR Onboarding', category: 'Manufacturing', kind: 'Project', description: 'Collect and organize new hire paperwork, information, and to-dos.' },
        { id: 'tpl-5', name: 'Patient Onboarding', category: 'Healthcare', kind: 'Project', description: 'Collect IDs, forms, insurance details and consent in a secure workspace.' },
        { id: 'tpl-6', name: 'Safety Incident Report', category: 'Construction', kind: 'Project', description: 'Log security issues, attach evidence, and assign to-dos for resolution.' },
        { id: 'tpl-7', name: 'Real Estate Closing', category: 'Real estate', kind: 'Project', description: 'Track disclosures, signatures and closing documents in one checklist.' },
      ],
      templateCategories: ['Accounting', 'Construction', 'Finance', 'Healthcare', 'Legal', 'Manufacturing', 'Real estate'],
      customTemplates: [],
      workflows: [],
      workflowRuns: [],
      messages: [],
      employees: [],
      clientContacts: [],
      prospects: [],
      sharedAddressBook: [],
      personalAddressBook: [],
      // distributionGroups removed: groups are server-backed now, via
      // /portal/groups (see portal-people.js).
      clientHubAccess: { enabled: true, allowSelfRegistration: false },
      connectors: [
        { id: 'box', name: 'Box', description: 'Enable users to connect to their own Box account', action: 'Enable', enabled: false },
        { id: 'dropbox', name: 'Dropbox', description: 'Enable users to connect to their own Dropbox account', action: 'Enable', enabled: false },
        { id: 'googledrive', name: 'Google Drive', description: 'Enable users to connect to their own Google Drive account', action: 'Enable', enabled: false },
        { id: 'onedrive', name: 'OneDrive', description: 'Enable users to connect to their own OneDrive account', action: 'Enable', enabled: false },
        { id: 'onedrivebusiness', name: 'OneDrive for Business', description: 'Enable users to connect to their own OneDrive for Business account', action: 'Add', enabled: false },
        { id: 'sharepoint', name: 'SharePoint Online', description: 'Enable users to connect to their own SharePoint Online account', action: 'Add', enabled: false },
      ],
      reports: [],
      recurringReports: [],
      notificationHistory: [],
      backgroundOps: [],
      /* Every security and preference screen reads its own endpoint now, so
         nothing is left in here. Kept as an empty object rather than removed:
         load() merges `fresh.settings` key by key, and a browser holding the
         old blob would hit an undefined otherwise. */
      settings: {},
    };
  }

  var state = null;

  function load() {
    if (state) return state;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        state = JSON.parse(raw);
        // merge new seed keys added after first save
        var fresh = seed();
        Object.keys(fresh).forEach(function (k) {
          if (state[k] === undefined) state[k] = fresh[k];
        });
        Object.keys(fresh.settings).forEach(function (k) {
          if (!state.settings[k]) state.settings[k] = fresh.settings[k];
        });
        var stripped = false;
        if (state.folders && state.folders.personal) {
          var personalBefore = state.folders.personal.length;
          state.folders.personal = state.folders.personal.filter(function (f) {
            return f.kind !== 'filebox' && !isSeededFakeFolderItem(f);
          });
          if (state.folders.personal.length !== personalBefore) stripped = true;
        }
        if (state.employees && state.employees.length) {
          var employeesBefore = state.employees.length;
          state.employees = state.employees.filter(function (emp) { return !isSeededFakeEmployee(emp); });
          if (state.employees.length !== employeesBefore) stripped = true;
        }
        /* Settings pages that were removed rather than built. Their state sat
           in localStorage and nothing reads it now, but a browser that used
           the portal before the removal still carries it, and the merge above
           only ever adds keys, so without this it would live there forever. */
        RETIRED_KEYS.forEach(function (k) {
          if (state[k] !== undefined) { delete state[k]; stripped = true; }
        });
        if (state.settings) {
          RETIRED_SETTINGS.forEach(function (k) {
            if (state.settings[k] !== undefined) { delete state.settings[k]; stripped = true; }
          });
        }
        // Signature requests are server-backed now; drop any seeded copies a
        // browser still holds from the prototype so nothing stale can surface.
        if (state.signatureRequests) {
          delete state.signatureRequests;
          stripped = true;
        }
        if (stripped) save();
        return state;
      }
    } catch (e) { /* fall through to seed */ }
    state = seed();
    save();
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function reset() {
    state = seed();
    save();
    return state;
  }

  /* Purge deleted projects older than the retention window (45 days). */
  function purgeExpiredProjects() {
    var s = load();
    var cutoff = Date.now() - DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    var before = s.projects.length;
    s.projects = s.projects.filter(function (p) {
      return !(p.status === 'deleted' && p.deletedAt && p.deletedAt < cutoff);
    });
    if (s.projects.length !== before) save();
  }

  function logNotification(subject, email) {
    var s = load();
    s.notificationHistory.unshift({
      id: uid('note'),
      date: shortDate(),
      time: dateTime(),
      email: email || s.user.email,
      subject: subject,
    });
    save();
  }

  function logBackgroundOp(name) {
    var s = load();
    var op = { id: uid('op'), name: name, status: 'completed', date: dateTime() };
    s.backgroundOps.unshift(op);
    save();
    return op;
  }

  window.TMAPortalData = {
    state: load,
    save: save,
    reset: reset,
    uid: uid,
    shortDate: shortDate,
    dateTime: dateTime,
    purgeExpiredProjects: purgeExpiredProjects,
    logNotification: logNotification,
    logBackgroundOp: logBackgroundOp,
    DELETED_RETENTION_DAYS: DELETED_RETENTION_DAYS,
    FILEBOX_RETENTION_DAYS: FILEBOX_RETENTION_DAYS,
  };
})();
