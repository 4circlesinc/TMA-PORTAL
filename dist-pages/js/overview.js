/*
 * TMA - Dashboard Overview (Figma 32546:96118, Targets 32546:96121, Budget 32546:96117, Files 32546:96116, Activity 32546:96119, Settings 32546:96115)
 * Global: window.TMAOverview
 */
(function () {
  'use strict';

  var ICON = '/TMA-PORTAL/images/icons/phosphor/';
  var TMA = '/TMA-PORTAL/images/icons/tma/';
  var AVATAR = '/TMA-PORTAL/images/avatars/';

  function fileIconSrc(key, filename) {
    if (window.TMAFileIcons && TMAFileIcons.fileIconSrc) {
      return TMAFileIcons.fileIconSrc(key, filename);
    }
    return ICON + key + '.svg';
  }

  var TABS = ['Overview', 'Targets', 'Budget', 'Users', 'Files', 'Activity', 'Settings'];

  var TARGET_COLUMNS = [
    {
      id: 'yet-to-start',
      title: 'Yet to Start',
      accent: 'blue',
      cards: [
        { tag: 'Technical Debt Reduction', title: 'Meeting with customer', description: 'Reduce technical debt by refactoring legacy code and improving architecture design.', avatar: 'AvatarByewind', attachments: 6, comments: 12 },
        { tag: 'User Experience', title: 'User Module Testing', description: 'Enhance user experience by incorporating user feedback and conducting usability testing.', avatar: 'AvatarFemale01', attachments: 9, comments: 19 },
        { tag: 'Security Implementation', title: 'Branding Logo', description: 'Implement security measures to protect against cyber attacks and data breaches.', avatar: 'AvatarMale01', attachments: 6, comments: 21 },
        { tag: 'Collaboration Improvement', title: 'Sales report page', description: 'Increase collaboration between developers and stakeholders through agile methodologies and effective communication.', avatar: 'AvatarAbstract01', attachments: 8, comments: 21 },
        { tag: 'Security Enhancement', title: 'API integration', description: 'Reduce technical debt by refactoring legacy code and improving architecture design.', avatar: 'AvatarMale03', attachments: 4, comments: 11 },
        { tag: 'Documentation Update', title: 'Design main Dashboard', description: 'Reduce technical debt by refactoring legacy code and improving architecture design.', avatar: 'AvatarFemale02', attachments: 3, comments: 7 },
      ],
    },
    {
      id: 'in-progress',
      title: 'In Progress',
      accent: 'purple',
      cards: [
        { tag: 'Code Quality', title: 'Sales report page', description: 'Increase code quality through code reviews and automated testing.', avatar: 'AvatarFemale05', attachments: 8, comments: 15 },
        { tag: 'Feature Development', title: 'Meeting with customer', description: 'Implement new features and functionality to meet customer needs and stay competitive.', avatarGroup: ['Avatar3d01', 'AvatarFemale04', 3], attachments: 6, comments: 82 },
        { tag: 'Scalability Enhancement', title: 'Design main Dashboard', description: 'Increase software scalability and flexibility to accommodate growth and change.', avatar: 'AvatarAbstract02', attachments: 8, comments: 22 },
        { tag: 'Process Streamlining', title: 'User Module Testing', description: 'Streamline development processes through automation and continuous integration/continuous delivery (CI/CD).', avatar: 'AvatarFemale02', attachments: 12, comments: 32 },
      ],
    },
    {
      id: 'completed',
      title: 'Completed',
      accent: 'green',
      cards: [
        { tag: 'Performance Optimization', title: 'Branding Logo', description: 'Improve software performance by optimizing algorithms and system resources.', avatar: 'Avatar3d01', attachments: 2, comments: 15 },
        { tag: 'Bug Reduction', title: 'To check User Management', description: 'Reduce software bugs and errors through bug tracking and issue resolution.', avatar: 'AvatarFemale05', attachments: 1, comments: 18 },
        { tag: 'Productivity Boost', title: 'User Module Testing', description: 'Improve developer productivity by providing better tools and resources.', avatar: 'Avatar3d03', attachments: 3, comments: 12 },
        { tag: 'Innovation Culture', title: 'Meeting with customer', description: 'Foster a culture of innovation and experimentation to drive continuous improvement.', avatar: 'Avatar3d02', attachments: 6, comments: 17 },
        { tag: 'Testing Improvement', title: 'User onboarding flow', description: 'Reduce technical debt by refactoring legacy code and improving architecture design.', avatar: 'Avatar3d02', attachments: 5, comments: 14 },
        { tag: 'Maintenance Planning', title: 'Dashboard widgets', description: 'Reduce technical debt by refactoring legacy code and improving architecture design.', avatar: 'AvatarMale05', attachments: 7, comments: 18 },
        { tag: 'Innovation Initiative', title: 'Mobile app redesign', description: 'Reduce technical debt by refactoring legacy code and improving architecture design.', avatar: 'AvatarFemale03', attachments: 10, comments: 25 },
        { tag: 'Code Quality', title: 'Sales report page', description: 'Increase code quality through code reviews and automated testing.', avatar: 'AvatarFemale06', attachments: 8, comments: 15 },
      ],
    },
  ];

  var WEEK = [
    { label: 'SU', day: '22' },
    { label: 'Mo', day: '23', active: true },
    { label: 'Tu', day: '24' },
    { label: 'We', day: '25' },
    { label: 'Th', day: '26' },
    { label: 'Fr', day: '27' },
    { label: 'Sa', day: '28' },
  ];

  var ROAD = [
    { avatar: 'AvatarFemale05', text: 'You have a bug that needs to be fixed.', time: 'Just now' },
    { avatar: 'AvatarMale05', text: 'Released a new version', time: '59 minutes ago' },
    { avatar: 'AvatarFemale02', text: 'Submitted a bug', time: '12 hours ago' },
    { avatar: 'AvatarAbstract01', text: 'Modified A data in Page X', time: 'Today, 11:59 AM' },
    { avatar: 'AvatarMale05', text: 'Deleted a page in Project X', time: 'Feb 2, 2026' },
  ];

  var FILES = [
    { icon: 'FilePdf', tone: 'purple', name: 'Project tech requirements.pdf', meta: '5.6 MB / Just now / Karina Clark', download: true },
    { icon: 'FileImage', tone: 'blue', name: 'Dashboard-design.jpg', meta: '2.3 MB / 59 minutes ago / Marcus Blake', download: false },
    { icon: 'FilePdf', tone: 'purple', name: 'Completed Project Stylings.pdf', meta: '4.6 MB / 12 hours ago / Terry Barry', download: false },
    { icon: 'FileXls', tone: 'blue', name: 'Create Project Wireframes.xls', meta: '1.2 MB / Today, 11:59 AM / Roth Bloom', download: false },
    { icon: 'FilePdf', tone: 'purple', name: 'Project tech requirements.pdf', meta: '2.8 MB / Yesterday / Natali Craig', download: false },
  ];

  var SPENDINGS = [
    { avatar: 'AvatarByewind', name: 'ByeWind', date: 'Jun 24, 2026', amount: '$942.00', status: 'In Progress', chip: 'purple' },
    { avatar: 'AvatarFemale06', name: 'Natali Craig', date: 'Mar 10, 2026', amount: '$881.00', status: 'Complete', chip: 'green' },
    { avatar: 'AvatarMale01', name: 'Drew Cano', date: 'Nov 10, 2026', amount: '$409.00', status: 'Pending', chip: 'blue' },
    { avatar: 'AvatarMale03', name: 'Orlando Diggs', date: 'Dec 20, 2026', amount: '$953.00', status: 'Approved', chip: 'orange' },
    { avatar: 'AvatarFemale01', name: 'Andi Lane', date: 'Jul 25, 2026', amount: '$907.00', status: 'Rejected', chip: 'muted' },
  ];

  var USAGE_CARDS = [
    { id: 'precise', title: 'Precise Usage', description: 'Less than $5,000 per transaction.', selected: true },
    { id: 'normal', title: 'Normal Usage', description: 'More than $5,000 per transaction.', selected: false },
    { id: 'extreme', title: 'Extreme Usage', description: 'More than $50,000 per transaction.', selected: false },
  ];

  var BUDGET_NOTES = 'Organize your thoughts with an outline. Here\u2019s the outlining strategy I use. I promise it works like a charm. Not only will it make writing your blog post easier, it\u2019ll help you make your message.';

  var SETTINGS_DESCRIPTION = 'Advisory Portal is a design system and UI workspace created with Figma.\n\nAll of the products here use the Portal library as the main component library.';

  var TAB_PANELS = {
    Overview: '.tma-dash__overview-grid',
    Targets: '.tma-dash__overview-targets',
    Budget: '.tma-dash__overview-budget',
    Users: '.tma-dash__overview-users',
    Files: '.tma-dash__overview-files-tab',
    Activity: '.tma-dash__overview-activity-tab',
    Settings: '.tma-dash__overview-settings',
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderTabs(activeTab) {
    var current = activeTab || 'Overview';
    var items = TABS.map(function (label) {
      var active = label === current;
      return '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '" data-overview-tab="' + esc(label) + '">' +
        '<span class="tma-tab__label">' + esc(label) + '</span>' +
        '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
        '</button>';
    }).join('');
    return '<div class="tma-dash__overview-toolbar">' +
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__overview-tabs" role="tablist">' + items + '</div>' +
      '<div class="tma-dash__overview-actions">' +
      '<button type="button" class="tma-dash__overview-btn"><img src="' + ICON + 'Plus.svg" alt=""><span>Add User</span></button>' +
      '<button type="button" class="tma-dash__overview-btn"><span>Add Target</span></button>' +
      '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--icon" aria-label="More"><img src="' + TMA + 'ThreeDots-16.svg" alt=""></button>' +
      '</div></div>';
  }

  function renderHero() {
    return '<section class="tma-dash__overview-block tma-dash__overview-block--hero" data-node-id="32546:46983">' +
      '<div class="tma-dash__overview-hero-main">' +
      '<div class="tma-dash__overview-metrics">' +
      '<div class="tma-dash__overview-metric tma-dash__overview-metric--status">' +
      '<span class="tma-dash__overview-metric-label">Status</span>' +
      '<div class="tma-dash__overview-status" aria-label="In Progress 51 percent">' +
      '<div class="tma-dash__overview-status-fill" style="width:51%"></div>' +
      '<span class="tma-dash__overview-status-text">' +
      '<span class="tma-dash__overview-status-label">In Progress</span>' +
      '<span class="tma-dash__overview-status-pct">51%</span></span>' +
      '</div></div>' +
      '<div class="tma-dash__overview-metric-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-metric"><span class="tma-dash__overview-metric-label">Total Tasks</span>' +
      '<p class="tma-dash__overview-metric-value"><strong>15</strong><span class="tma-dash__overview-metric-sep"> / </span><strong>48</strong></p></div>' +
      '<div class="tma-dash__overview-metric-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-metric"><span class="tma-dash__overview-metric-label">Due Date</span>' +
      '<p class="tma-dash__overview-metric-value"><strong>29 Jan, 2026</strong></p></div>' +
      '<div class="tma-dash__overview-metric-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-metric"><span class="tma-dash__overview-metric-label">Budget Spent</span>' +
      '<p class="tma-dash__overview-metric-value"><strong>$15,000</strong></p></div>' +
      '</div></div>' +
      '<div class="tma-dash__overview-hero-side">' +
      '<div class="tma-dash__avatars tma-dash__avatars--project">' +
      '<img class="tma-dash__avatar tma-dash__avatar--28" src="' + AVATAR + 'AvatarByewind.png" alt="">' +
      '<img class="tma-dash__avatar tma-dash__avatar--28" src="' + AVATAR + 'AvatarFemale05.png" alt="">' +
      '<span class="tma-dash__avatar tma-dash__avatar--more tma-dash__avatar--28">+3</span>' +
      '</div></div></section>';
  }

  function renderWeek() {
    return WEEK.map(function (d) {
      return '<button type="button" class="tma-dash__overview-day' + (d.active ? ' tma-dash__overview-day--active' : '') + '">' +
        '<span class="tma-dash__overview-day-label">' + esc(d.label) + '</span>' +
        '<span class="tma-dash__overview-day-num">' + esc(d.day) + '</span></button>';
    }).join('');
  }

  function renderRoad() {
    var items = ROAD.map(function (item) {
      return '<div class="tma-dash__overview-road-item">' +
        '<img class="tma-dash__overview-road-avatar" src="' + AVATAR + item.avatar + '.png" alt="">' +
        '<div class="tma-dash__overview-road-body">' +
        '<span class="tma-dash__overview-road-text">' + esc(item.text) + '</span>' +
        '<span class="tma-dash__overview-road-time">' + esc(item.time) + '</span></div></div>';
    }).join('');
    return '<section class="tma-dash__overview-block tma-dash__overview-block--road" data-node-id="32546:46995">' +
      '<h3 class="tma-dash__overview-block-title">What\'s on the road?</h3>' +
      '<div class="tma-dash__overview-week">' + renderWeek() + '</div>' +
      '<div class="tma-dash__overview-road">' +
      '<div class="tma-dash__overview-road-line" aria-hidden="true"></div>' +
      '<div class="tma-dash__overview-road-list">' + items + '</div></div></section>';
  }

  function renderFiles() {
    var rows = FILES.map(function (f) {
      var dl = f.download
        ? '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--icon" aria-label="Download"><img src="' + ICON + 'DownloadSimple.svg" alt=""></button>'
        : '';
      return '<div class="tma-dash__overview-file-row">' +
        '<div class="tma-dash__overview-file-main">' +
        '<span class="tma-dash__overview-file-icon tma-dash__overview-file-icon--' + esc(f.tone) + '">' +
        '<img src="' + fileIconSrc(f.icon, f.name) + '" alt=""></span>' +
        '<div class="tma-dash__overview-file-copy">' +
        '<p class="tma-dash__overview-file-name">' + esc(f.name) + '</p>' +
        '<p class="tma-dash__overview-file-meta">' + esc(f.meta) + '</p></div></div>' + dl + '</div>';
    }).join('');
    return '<section class="tma-dash__overview-block tma-dash__overview-block--files" data-node-id="32546:47005">' +
      '<h3 class="tma-dash__overview-block-title">Latest Files</h3>' +
      '<div class="tma-dash__overview-files-body">' +
      '<div class="tma-dash__overview-files">' + rows + '</div>' +
      '<div class="tma-dash__overview-upload">' +
      '<p class="tma-dash__overview-upload-hint">Drop files here or upload files</p>' +
      '<button type="button" class="tma-dash__overview-btn tma-dash__overview-btn--solid"><span>Upload</span></button>' +
      '</div></div></section>';
  }

  function renderSpendings() {
    var head = '<div class="tma-dash__overview-table-head">' +
      '<span>Manager</span><span>Date</span><span>Amount</span><span>Status</span></div>';
    var rows = SPENDINGS.map(function (r) {
      return '<div class="tma-dash__overview-table-row">' +
        '<div class="tma-dash__overview-table-cell tma-dash__overview-table-cell--manager">' +
        '<img class="tma-dash__avatar" src="' + AVATAR + r.avatar + '.png" alt="">' +
        '<span>' + esc(r.name) + '</span></div>' +
        '<div class="tma-dash__overview-table-cell tma-dash__overview-table-cell--date" data-label="Date">' + esc(r.date) + '</div>' +
        '<div class="tma-dash__overview-table-cell tma-dash__overview-table-cell--amount" data-label="Amount">' + esc(r.amount) + '</div>' +
        '<div class="tma-dash__overview-table-cell tma-dash__overview-table-cell--status">' +
        '<span class="tma-dash__chip tma-dash__chip--' + esc(r.chip) + '"><i class="tma-dash__chip-dot"></i>' + esc(r.status) + '</span></div></div>';
    }).join('');
    return '<section class="tma-dash__overview-block tma-dash__overview-block--spendings" data-node-id="32546:47014">' +
      '<h3 class="tma-dash__overview-block-title">Project Spendings</h3>' +
      '<div class="tma-dash__overview-table">' + head + rows + '</div></section>';
  }

  function renderTargetCard(card, index) {
    var opts = {
      nodeId: '32546:96121-card-' + index,
      tag: card.tag,
      title: card.title,
      description: card.description,
      attachments: card.attachments,
      comments: card.comments,
    };
    if (card.avatarGroup) opts.avatarGroup = card.avatarGroup;
    else if (card.avatar) opts.avatar = card.avatar;
    if (window.TMACard && typeof window.TMACard.renderTaskCard === 'function') {
      return window.TMACard.renderTaskCard(opts);
    }
    return '<article class="tma-card tma-card--task"><span class="tma-card__task-tag">' + esc(card.tag) + '</span>' +
      '<p class="tma-card__task-title">' + esc(card.title) + '</p>' +
      '<p class="tma-card__task-description">' + esc(card.description) + '</p></article>';
  }

  function renderTargets(activeTab) {
    var cols = TARGET_COLUMNS.map(function (col) {
      var cards = col.cards.map(function (card, i) {
        return renderTargetCard(card, col.id + '-' + i);
      }).join('');
      return '<div class="tma-dash__overview-targets-col" data-column="' + esc(col.id) + '">' +
        '<div class="tma-dash__overview-targets-col-head">' +
        '<p class="tma-dash__overview-targets-col-title">' + esc(col.title) +
        ' <span class="tma-dash__overview-targets-col-count">' + col.cards.length + '</span></p>' +
        '<div class="tma-dash__overview-targets-col-line tma-dash__overview-targets-col-line--' + esc(col.accent) + '" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="tma-dash__overview-targets-cards">' + cards + '</div></div>';
    }).join('');
    return '<div class="tma-dash__overview-targets" data-node-id="32546:96121"' + (activeTab !== 'Targets' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__overview-targets-board">' + cols + '</div></div>';
  }

  function renderBudgetStrip() {
    if (window.TMAStrip && typeof window.TMAStrip.renderStrip === 'function') {
      return window.TMAStrip.renderStrip({
        nodeId: '32546:46963',
        track: true,
        height: 8,
        paddingRight: 240,
        segments: ['indigo', 'black', 'black', 'black', 'black', 'black', 'black'],
      });
    }
    var segs = ['indigo', 'black', 'black', 'black', 'black', 'black', 'black'].map(function (tone, i) {
      return '<span class="tma-dash__overview-budget-seg' + (tone === 'indigo' ? ' tma-dash__overview-budget-seg--indigo' : '') + '"></span>';
    }).join('');
    return '<div class="tma-dash__overview-budget-strip" data-node-id="32546:46963">' + segs + '</div>';
  }

  function renderUsageCard(card, index) {
    var opts = {
      nodeId: '32546:96117-usage-' + index,
      title: card.title,
      description: card.description,
      selected: card.selected,
      radio: true,
    };
    if (window.TMACard && typeof window.TMACard.renderUsageCard === 'function') {
      return window.TMACard.renderUsageCard(opts);
    }
    return '<button type="button" class="tma-card tma-card--usage' + (card.selected ? ' tma-card--usage-selected' : '') + '">' +
      '<span class="tma-card__usage-title">' + esc(card.title) + '</span>' +
      '<span class="tma-card__usage-description">' + esc(card.description) + '</span></button>';
  }

  function renderBudgetField(title, value, nodeId, multiline) {
    if (window.TMAInput && typeof window.TMAInput.renderFormTitleValue === 'function' && !multiline) {
      return window.TMAInput.renderFormTitleValue({
        nodeId: nodeId,
        title: title,
        value: value,
        glass: true,
      });
    }
    var control = multiline
      ? '<textarea class="tma-input__control tma-input__control--textarea" rows="3">' + esc(value) + '</textarea>'
      : '<input class="tma-input__control" type="text" value="' + esc(value) + '">';
    return '<div class="tma-input tma-input--form-field tma-input--glass tma-input--has-value tma-input--active" data-node-id="' + esc(nodeId) + '">' +
      '<span class="tma-input__label">' + esc(title) + '</span>' + control + '</div>';
  }

  function renderBudgetFormField(type, opts) {
    if (!window.TMAInput) return '';
    if (type === 'checkbox' && window.TMAInput.renderFormCheckboxGroup) {
      return window.TMAInput.renderFormCheckboxGroup(Object.assign({ glass: true }, opts));
    }
    if (type === 'switch' && window.TMAInput.renderFormSwitchField) {
      return window.TMAInput.renderFormSwitchField(Object.assign({ glass: true }, opts));
    }
    return '';
  }

  function renderBudget(activeTab) {
    var usageCards = USAGE_CARDS.map(function (card, i) {
      return renderUsageCard(card, i);
    }).join('');

    return '<div class="tma-dash__overview-budget" data-node-id="32546:96117"' + (activeTab !== 'Budget' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__overview-budget-stack">' +
      '<section class="tma-dash__overview-block tma-dash__overview-block--budget-summary">' +
      '<div class="tma-dash__overview-budget-head">' +
      '<h2 class="tma-dash__overview-budget-title">Budget</h2>' +
      '<p class="tma-dash__overview-budget-used">$22,300 of 36,000 Used</p></div>' +
      renderBudgetStrip() +
      '<p class="tma-dash__overview-budget-remaining">18 Targets are remaining</p>' +
      '</section>' +
      '<section class="tma-dash__overview-block tma-dash__overview-block--budget-form">' +
      '<h3 class="tma-dash__overview-block-title">Usage Character</h3>' +
      '<div class="tma-dash__overview-budget-usage">' + usageCards + '</div>' +
      renderBudgetField('Budget Notes', BUDGET_NOTES, '32546:46971', true) +
      renderBudgetField('Manage Budget', '$36000.00', '32546:46972', false) +
      renderBudgetFormField('checkbox', {
        nodeId: '32546:46973',
        title: 'Overuse Notifications',
        items: [
          { label: 'Email', checked: true },
          { label: 'Phone', checked: false },
        ],
      }) +
      renderBudgetFormField('switch', {
        nodeId: '32546:46974',
        title: 'Allow Changes',
        text: 'Allowed',
        on: true,
      }) +
      '<div class="tma-dash__overview-budget-actions">' +
      '<button type="button" class="tma-dash__overview-budget-btn">Cancel</button>' +
      '<button type="button" class="tma-dash__overview-budget-btn tma-dash__overview-budget-btn--primary">Save Changes</button>' +
      '</div></section></div></div>';
  }

  function renderSettingsLogoCard() {
    return '<section class="tma-dash__overview-block tma-dash__overview-settings-logo" data-node-id="32546:46863">' +
      '<button type="button" class="tma-dash__overview-settings-upload" aria-label="Upload project logo">' +
      '<span class="tma-dash__overview-settings-upload-icon">' +
      '<img src="' + ICON + 'UploadSimple.svg" alt=""></span></button>' +
      '<div class="tma-dash__overview-settings-logo-copy">' +
      '<p class="tma-dash__overview-settings-logo-title">Advisory Portal</p>' +
      '<p class="tma-dash__overview-settings-logo-hint">Click upload Logo, allowed file types: png, jpg, jpeg.</p>' +
      '</div></section>';
  }

  function renderSettingsFormField(type, opts) {
    if (!window.TMAInput) return '';
    if (type === 'select' && window.TMAInput.renderFormSelectValue) {
      return window.TMAInput.renderFormSelectValue(Object.assign({ glass: true }, opts));
    }
    if (type === 'date' && window.TMAInput.renderFormDateField) {
      return window.TMAInput.renderFormDateField(Object.assign({ glass: true, valueBlack: true }, opts));
    }
    return renderBudgetFormField(type, opts);
  }

  function renderSettings(activeTab) {
    var projectName = window.TMAInput && window.TMAInput.renderFormTitleValue
      ? window.TMAInput.renderFormTitleValue({
          nodeId: '32546:46866',
          title: 'Project Name',
          value: 'Advisory Portal',
          glass: true,
        })
      : renderBudgetField('Project Name', 'Advisory Portal', '32546:46866', false);

    return '<div class="tma-dash__overview-settings" data-node-id="32546:96115"' + (activeTab !== 'Settings' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__overview-settings-stack">' +
      renderSettingsLogoCard() +
      '<section class="tma-dash__overview-block tma-dash__overview-settings-form">' +
      '<h3 class="tma-dash__overview-block-title">More Settings</h3>' +
      projectName +
      renderSettingsFormField('select', {
        nodeId: '32546:46867',
        title: 'Project Type',
        value: 'UI Kit',
        options: [
          { value: 'UI Kit', label: 'UI Kit', selected: true },
          { value: 'Web App', label: 'Web App' },
          { value: 'Mobile App', label: 'Mobile App' },
        ],
      }) +
      renderBudgetField('Project Description', SETTINGS_DESCRIPTION, '32546:46868', true) +
      renderSettingsFormField('date', {
        nodeId: '32546:46869',
        title: 'Due Date',
        value: 'Feb 1, 2026',
      }) +
      renderSettingsFormField('checkbox', {
        nodeId: '32546:46870',
        title: 'Overuse Notifications',
        items: [
          { label: 'Email', checked: true },
          { label: 'Phone', checked: false },
        ],
      }) +
      renderSettingsFormField('switch', {
        nodeId: '32546:46871',
        title: 'Status',
        text: 'Active',
        on: true,
      }) +
      '<div class="tma-dash__overview-settings-actions">' +
      '<button type="button" class="tma-dash__overview-settings-btn">Cancel</button>' +
      '<button type="button" class="tma-dash__overview-settings-btn tma-dash__overview-settings-btn--primary">Save Changes</button>' +
      '</div></section></div></div>';
  }

  function renderUsers(activeTab) {
    return '<div class="tma-dash__overview-users" data-node-id="32546:96120"' + (activeTab !== 'Users' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__users" data-users-overview></div></div>';
  }

  function renderFilesTab(activeTab) {
    return '<div class="tma-dash__overview-files-tab" data-node-id="32546:96116"' + (activeTab !== 'Files' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__files" data-files-overview></div></div>';
  }

  function renderActivityTab(activeTab) {
    return '<div class="tma-dash__overview-activity-tab" data-node-id="32546:96119"' + (activeTab !== 'Activity' ? ' hidden' : '') + '>' +
      '<div class="tma-dash__activity" data-activity-overview></div></div>';
  }

  function mountUsersTab(container) {
    var mountEl = container.querySelector('[data-users-overview]');
    if (!mountEl || !window.TMAUsers || typeof window.TMAUsers.mount !== 'function') return;
    window.TMAUsers.mount(mountEl, { context: 'overview' });
  }

  function mountFilesTab(container) {
    var mountEl = container.querySelector('[data-files-overview]');
    if (!mountEl || !window.TMAOverviewFiles || typeof window.TMAOverviewFiles.mount !== 'function') return;
    window.TMAOverviewFiles.mount(mountEl);
  }

  function mountActivityTab(container) {
    var mountEl = container.querySelector('[data-activity-overview]');
    if (!mountEl || !window.TMAOverviewActivity || typeof window.TMAOverviewActivity.mount !== 'function') return;
    window.TMAOverviewActivity.mount(mountEl);
  }

  function syncOverviewChrome(tab) {
    var dash = document.querySelector('.tma-dash');
    var overviewView = dash && dash.querySelector('.tma-dash__view[data-view="overview"]');
    if (!overviewView || overviewView.hidden) return;

    var mainHead = dash.querySelector('.tma-dash__main-head');
    var viewToggleWrap = dash.querySelector('[data-page-view-toggle]');
    if (mainHead) mainHead.style.display = 'none';
    if (viewToggleWrap) viewToggleWrap.hidden = true;

    if (tab === 'Users' && window.TMAUsers && typeof window.TMAUsers.setActiveContext === 'function') {
      window.TMAUsers.setActiveContext('overview');
    }
  }

  function render(activeTab) {
    var tab = activeTab || 'Overview';
    return '<div class="tma-dash__overview" data-node-id="32546:96118">' +
      renderTabs(tab) +
      '<div class="tma-dash__overview-grid"' + (tab !== 'Overview' ? ' hidden' : '') + '>' +
      renderHero() + renderRoad() + renderFiles() + renderSpendings() +
      '</div>' +
      renderTargets(tab) +
      renderBudget(tab) +
      renderUsers(tab) +
      renderFilesTab(tab) +
      renderActivityTab(tab) +
      renderSettings(tab) +
      '</div>';
  }

  function setActiveTab(container, tab) {
    if (!container) return;
    var overview = container.querySelector('.tma-dash__overview');
    if (!overview) return;

    overview.querySelectorAll('[role="tab"]').forEach(function (btn) {
      var isActive = btn.getAttribute('data-overview-tab') === tab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    Object.keys(TAB_PANELS).forEach(function (key) {
      var panel = overview.querySelector(TAB_PANELS[key]);
      if (panel) panel.hidden = tab !== key;
    });

    if (tab === 'Budget') bindBudget(container);
    if (tab === 'Users') mountUsersTab(container);
    if (tab === 'Files') mountFilesTab(container);
    if (tab === 'Activity') mountActivityTab(container);
    if (tab === 'Settings') bindSettings(container);
    syncOverviewChrome(tab);
  }

  function bindUsageCards(container) {
    var usageRoot = container.querySelector('.tma-dash__overview-budget-usage');
    if (!usageRoot || usageRoot.dataset.bound) return;
    usageRoot.dataset.bound = '1';
    usageRoot.addEventListener('click', function (e) {
      var card = e.target.closest('.tma-card--usage');
      if (!card || !usageRoot.contains(card)) return;
      usageRoot.querySelectorAll('.tma-card--usage').forEach(function (el) {
        el.classList.remove('tma-card--usage-selected', 'is-selected');
        var radio = el.querySelector('.tma-card__usage-radio');
        if (radio && window.TMACardIcons) {
          radio.innerHTML = window.TMACardIcons.svg('Circle24', 'tma-card__usage-radio-svg', 24, 24);
        }
      });
      card.classList.add('tma-card--usage-selected', 'is-selected');
      var selectedRadio = card.querySelector('.tma-card__usage-radio');
      if (selectedRadio && window.TMACardIcons) {
        selectedRadio.innerHTML = window.TMACardIcons.svg('RadioAlt24', 'tma-card__usage-radio-svg', 24, 24);
      }
    });
  }

  function bindSettings(container) {
    var settings = container.querySelector('.tma-dash__overview-settings');
    if (!settings || settings.dataset.bound) return;
    settings.dataset.bound = '1';
    if (window.TMAInput && typeof window.TMAInput.mountInteractive === 'function') {
      window.TMAInput.mountInteractive(settings);
    }
  }

  function bindBudget(container) {
    var budget = container.querySelector('.tma-dash__overview-budget');
    if (!budget || budget.dataset.bound) return;
    budget.dataset.bound = '1';
    bindUsageCards(container);
    if (window.TMAInput && typeof window.TMAInput.mountInteractive === 'function') {
      window.TMAInput.mountInteractive(budget);
    }
  }

  function bindTabs(container) {
    if (!container || container.dataset.overviewTabsBound) return;
    container.dataset.overviewTabsBound = '1';
    container.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-overview-tab]');
      if (!tabBtn || !container.contains(tabBtn)) return;
      setActiveTab(container, tabBtn.getAttribute('data-overview-tab'));
    });
  }

  function mount(container, opts) {
    if (!container) return;
    var activeTab = (opts && opts.tab) || 'Overview';
    container.innerHTML = render(activeTab);
    bindTabs(container);
    bindBudget(container);
    bindSettings(container);
    if (activeTab === 'Users') mountUsersTab(container);
    if (activeTab === 'Files') mountFilesTab(container);
    if (activeTab === 'Activity') mountActivityTab(container);
    setActiveTab(container, activeTab);
  }

  window.TMAOverview = { mount: mount, render: render, setActiveTab: setActiveTab, renderRoad: renderRoad };
})();
