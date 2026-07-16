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

  function seed() {
    return {
      user: {
        firstName: 'Vernon',
        lastName: 'Francis',
        name: 'Vernon Francis',
        email: 'vfrancis@tmantoinelaw.com',
        company: 'TM ANTOINE Advisory',
      },
      trial: {
        active: true,
        daysLeft: 2,
        signatureLimit: 5,
        signatureUsed: 0,
        employeeLimit: 3,
      },
      branding: {
        accountName: 'Testing',
        pageTitle: 'TM ANTOINE Advisory - Where Companies Connect',
        logoName: '',
        headerColor: '#FFFFFF',
        accentColor: '#0C0C0C',
      },
      dashboardTiles: {
        recentFiles: true,
        shortcuts: true,
        tutorials: false,
        favorites: false,
      },
      recentFiles: [
        { id: 'file-1', name: 'Design Brief – Healthy Smiles Dental Logo Project Overview.pdf', path: 'Personal Folders > Test', type: 'pdf' },
        { id: 'file-2', name: 'Hello_July_Saint_Lucia_Carnival_Brief_PlainBW.docx', path: 'Personal Folders > Test', type: 'doc' },
        { id: 'file-3', name: 'WISS2026 Lanyard – Dominica.png', path: 'Personal Folders > Test', type: 'png' },
      ],
      folders: {
        personal: [
          { id: 'folder-test', name: 'Test', kind: 'folder', items: 3, created: '06/28/2026' },
          { id: 'file-seed-1', name: 'Project_Brief.pdf', kind: 'file', created: '06/28/2026' },
          { id: 'file-seed-2', name: 'Client_Onboarding_Template.docx', kind: 'file', created: '06/27/2026' },
        ],
        shared: [],
        favorites: [],
        recycle: [],
      },
      tutorials: [
        { id: 'tut-1', label: 'Share a file securely', done: true },
        { id: 'tut-2', label: 'Request files from a client', done: true },
        { id: 'tut-3', label: 'Add people to your account', done: false },
        { id: 'tut-4', label: 'Personalize your account branding', done: false },
        { id: 'tut-5', label: 'Create your first project', done: false },
      ],
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
      employees: [
        {
          id: 'emp-1',
          firstName: 'Travis',
          lastName: 'Francis',
          email: 'igraphixmarketingco@gmail.com',
          company: 'Testing',
          lastLogin: '07/06/2026 12:56PM',
          admin: true,
        },
      ],
      clientContacts: [],
      prospects: [],
      sharedAddressBook: [],
      personalAddressBook: [],
      distributionGroups: [],
      superUsers: ['emp-1'],
      hideSuperGroup: false,
      serviceTeams: [],
      customFields: [],
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
      quarantinedFiles: [],
      fileDrops: [],
      remoteUploadForms: [],
      folderTemplates: [],
      settings: {
        deviceSecurity: {
          defaultMode: 'standard',
          selfDestruct: 'Never',
        },
        securityPolicy: {
          trustedDomains: '',
          autoRemediation: {
            impossibleTravel: true,
            downloadTrend: true,
            ipCountChange: true,
            failedSignIns: true,
            suspiciousIp: true,
          },
        },
        signInPolicy: {
          minLength: 8,
          numbersRequired: 1,
          specialRequired: 1,
        },
        alertSettings: {
          differentCountry: { admin: true, employees: true, clients: true },
          differentCity: { admin: true, employees: true, clients: true },
          failedSignIns: { admin: true, employees: true, clients: true },
          suspiciousUpload: { admin: true, employees: true, clients: true },
          alternateContacts: '',
        },
        dlp: {
          limitAccess: 'yes',
          rejected: {
            download: { anonymous: false, client: false, employee: true },
            share: { anonymous: false, client: false, employee: false },
          },
          ok: {
            download: { anonymous: true, client: true, employee: true },
            share: { anonymous: false, client: true, employee: true },
          },
          unscanned: {
            download: { anonymous: true, client: true, employee: true },
            share: { anonymous: false, client: true, employee: true },
          },
        },
        emailSettings: {
          sendVia: 'both',
          uploadReceipts: 'no',
          notifyFrequency: 'Every 15 minutes',
          language: 'Invariant',
          qaText: 'yes',
        },
        permissions: {
          clientShares: 'no',
          showPeopleTab: 'no',
        },
        fileSettings: {
          sortingEnabled: 'no',
          defaultSortField: 'Name',
          defaultSortDir: 'Ascending',
          versioningEnabled: 'yes',
          maxVersionsMode: 'Custom',
          maxVersions: 10000,
          fileBoxRetentionDays: FILEBOX_RETENTION_DAYS,
          watermarkEnabled: 'yes',
          watermarkText: '{Email}',
          officeEditing: 'yes',
          cloudRendering: 'no',
        },
        tools: {
          showAppsPage: true,
          desktopBetas: true,
          showInList: 'All Available',
          outlookPlugin: true,
          ftpsAccess: true,
        },
        ai: {
          requestList: true,
          docAssistant: true,
        },
      },
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
        if (state.folders && state.folders.personal) {
          state.folders.personal = state.folders.personal.filter(function (f) { return f.kind !== 'filebox'; });
        }
        // Signature requests are server-backed now; drop any seeded copies a
        // browser still holds from the prototype so nothing stale can surface.
        delete state.signatureRequests;
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
