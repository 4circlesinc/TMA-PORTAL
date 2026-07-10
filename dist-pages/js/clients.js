/*
 * TMA — Clients page ( /clients )
 * Global: window.TMAClients
 */
(function () {
  'use strict';

  var AVATAR = '/TMA-PORTAL/images/avatars/';
  var ICON = '/TMA-PORTAL/images/icons/phosphor/';

  var VIEW_KEY = 'tma.clientsViewMode.v1';

  var ICONS = {
    MagnifyingGlass: ICON + 'MagnifyingGlass.svg',
    UserCircle: ICON + 'UserCircle.svg',
    MapPin: ICON + 'MapPin.svg',
    EnvelopeSimple: ICON + 'EnvelopeSimple.svg',
    Phone: ICON + 'Phone.svg',
    ShareNetwork: ICON + 'ShareNetwork.svg',
    ChatTeardropDots: ICON + 'ChatTeardropDots.svg',
    PencilSimple: ICON + 'PencilSimple.svg',
    Plus: ICON + 'Plus.svg',
    FunnelSimple: '/TMA-PORTAL/images/icons/tma/FunnelSimple-16.svg',
    ArrowsDownUp: '/TMA-PORTAL/images/icons/tma/ArrowsDownUp.svg',
    Search: '/TMA-PORTAL/images/icons/tma/Search-16.svg',
    Line: '/TMA-PORTAL/images/icons/tma/Line-16.svg',
    Briefcase: ICON + 'Briefcase.svg',
    Buildings: ICON + 'Buildings.svg',
    Globe: ICON + 'Globe.svg',
    CalendarBlank: ICON + 'CalendarBlank.svg',
    LinkedinLogo: ICON + 'LinkedinLogo.svg',
    Trash: ICON + 'Trash.svg',
    Copy: '/TMA-PORTAL/images/icons/tma/Copy-16.svg',
    CaretLeft: ICON + 'CaretLeft.svg',
    User: ICON + 'User.svg',
    XCircle: ICON + 'Xcircle.svg',
    Loading16: '/TMA-PORTAL/images/icons/tma/Loading-16.svg',
    ArrowLineDown: '/TMA-PORTAL/images/icons/tma/ArrowLineDown-16.svg',
    CaretDown: ICON + 'CaretDown.svg',
    ArrowLineLeft: '/TMA-PORTAL/images/icons/tma/ArrowLineLeft-16.svg',
    ArrowLineRight: '/TMA-PORTAL/images/icons/tma/ArrowLineRight-16.svg',
    FolderNotch: ICON + 'FolderNotch.svg',
    FolderFilled: ICON + 'FolderFilled.svg',
    TwitterLogo: ICON + 'TwitterLogo.svg',
    InstagramLogo: ICON + 'InstagramLogo.svg',
    ThreadsLogo: ICON + 'ThreadsLogo.svg',
  };

  var SOCIAL_ICONS = {
    linkedin: ICONS.LinkedinLogo,
    twitter: ICONS.TwitterLogo,
    instagram: ICONS.InstagramLogo,
    threads: ICONS.ThreadsLogo,
  };

  var SOCIAL_LABELS = {
    linkedin: 'LinkedIn',
    twitter: 'Twitter',
    instagram: 'Instagram',
    threads: 'Threads',
  };

  var PROFILE_TABS = [
    { id: 'info', label: 'Client info' },
    { id: 'folders', label: 'Folders' },
    { id: 'assigned', label: 'Assigned' },
  ];

  var CONTACT_FOLDERS = {
    byewind: [
      { id: 'contracts', name: 'Contracts', count: 4, updated: 'Feb 12, 2026' },
      { id: 'proposals', name: 'Proposals', count: 7, updated: 'Jan 28, 2026' },
      { id: 'invoices', name: 'Invoices', count: 3, updated: 'Dec 4, 2025' },
    ],
    andi: [
      { id: 'design', name: 'Design assets', count: 18, updated: 'Mar 1, 2026' },
      { id: 'research', name: 'Research', count: 6, updated: 'Feb 20, 2026' },
    ],
    natali: [
      { id: 'support', name: 'Support tickets', count: 6, updated: 'Mar 12, 2026' },
      { id: 'onboarding', name: 'Onboarding', count: 3, updated: 'Feb 28, 2026' },
    ],
    bruce: [
      { id: 'legal', name: 'Legal', count: 9, updated: 'Jan 15, 2026' },
      { id: 'board', name: 'Board materials', count: 5, updated: 'Nov 8, 2025' },
    ],
  };

  var DEFAULT_FOLDERS = [
    { id: 'documents', name: 'Documents', count: 0, updated: '—' },
  ];

  var CONTACT_ASSIGNED = {
    byewind: [
      { id: 'tma-dashboard', title: 'TM ANTOINE Advisory dashboard', project: 'TM ANTOINE Advisory', time: '12hr 30min', due: 'Mar 18, 2026', status: 'in-progress', statusLabel: 'In Progress' },
      { id: 'api-integration', title: 'API integration review', project: 'TM ANTOINE Advisory', time: '4hr 15min', due: 'Mar 22, 2026', status: 'pending', statusLabel: 'Pending' },
      { id: 'prototype-handoff', title: 'Prototype handoff', project: 'Internal tools', time: '2hr 5min', due: 'Apr 1, 2026', status: 'approved', statusLabel: 'Approved' },
    ],
    andi: [
      { id: 'design-system', title: 'Design system refresh', project: 'TM ANTOINE Advisory', time: '26hr 10min', due: 'Mar 25, 2026', status: 'in-progress', statusLabel: 'In Progress' },
      { id: 'mobile-screens', title: 'Mobile screen polish', project: 'Client portal', time: '8hr 40min', due: 'Apr 4, 2026', status: 'pending', statusLabel: 'Pending' },
    ],
    drew: [
      { id: 'roadmap-q2', title: 'Q2 roadmap planning', project: 'Product ops', time: '6hr 20min', due: 'Mar 20, 2026', status: 'complete', statusLabel: 'Complete' },
      { id: 'stakeholder-review', title: 'Stakeholder review', project: 'TM ANTOINE Advisory', time: '3hr 0min', due: 'Mar 28, 2026', status: 'in-progress', statusLabel: 'In Progress' },
    ],
    bruce: [
      { id: 'vendor-contract', title: 'Vendor contract review', project: 'Wayne Enterprises', time: '1hr 45min', due: 'Mar 15, 2026', status: 'approved', statusLabel: 'Approved' },
    ],
  };

  var DEFAULT_ASSIGNED = [];

  var ASSIGNED_STATUS_COLORS = {
    'in-progress': 'purple',
    complete: 'green',
    pending: 'orange',
    approved: 'blue',
    rejected: 'red',
  };

  var DATE_TYPES = [
    { value: 'birthday', label: 'Birthday' },
    { value: 'anniversary', label: 'Anniversary' },
    { value: 'custom', label: 'Custom' },
  ];

  var PHONE_TYPES = [
    { value: 'mobile', label: 'Mobile' },
    { value: 'office', label: 'Office' },
    { value: 'home', label: 'Home' },
    { value: 'fax', label: 'Fax' },
  ];

  var EMAIL_TYPES = [
    { value: 'work', label: 'Work' },
    { value: 'personal', label: 'Personal' },
    { value: 'other', label: 'Other' },
  ];

  var ADDRESS_TYPES = [
    { value: 'work', label: 'Work' },
    { value: 'home', label: 'Home' },
    { value: 'other', label: 'Other' },
  ];

  var DIRECTORY = [
    { letter: 'A', items: [{ id: 'andi', name: 'Andi Lane', avatar: 'AvatarFemale01' }] },
    {
      letter: 'B',
      items: [
        { id: 'byewind', name: 'ByeWind', avatar: 'AvatarByewind' },
        { id: 'bruce', name: 'Bruce Wayne', initial: 'B', initialColor: 'blue' },
      ],
    },
    { letter: 'D', items: [{ id: 'drew', name: 'Drew Cano', avatar: 'AvatarMale01' }] },
    { letter: 'E', items: [{ id: 'emma', name: 'Emma Smith', avatar: 'Avatar3d04' }] },
    { letter: 'J', items: [{ id: 'john', name: 'John Smith', avatar: 'AvatarMale02' }] },
    {
      letter: 'K',
      items: [
        { id: 'kate', name: 'Kate Morrison', avatar: 'AvatarFemale04' },
        { id: 'koray', name: 'Koray Okumus', avatar: 'AvatarMale04' },
      ],
    },
    {
      letter: 'M',
      items: [
        { id: 'michael', name: 'Michael Brown', initial: 'M', initialColor: 'green' },
        { id: 'melody', name: 'Melody Macy', avatar: 'AvatarFemale05' },
      ],
    },
    { letter: 'N', items: [{ id: 'natali', name: 'Natali Craig', avatar: 'AvatarFemale06' }] },
    { letter: 'O', items: [{ id: 'orlando', name: 'Orlando Diggs', avatar: 'AvatarMale03' }] },
    { letter: 'W', items: [{ id: 'william', name: 'William Johnson', avatar: 'AvatarAbstract04' }] },
  ];

  var PROFILES = {
    byewind: {
      firstName: 'ByeWind',
      lastName: '',
      nickname: 'Bye',
      phones: [
        { type: 'mobile', value: '+852 19850622' },
        { type: 'office', value: '+852 2800 1234' },
      ],
      emails: [{ type: 'work', value: 'byewind@twitter.com' }],
      work: { jobTitle: 'Developer', department: 'Engineering', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'SF, Bay Area', state: '', zip: '', country: 'USA' }],
      website: 'https://byewind.com',
      birthday: '1990-03-15',
      importantDates: [
        { type: 'birthday', label: '', date: '1990-03-15' },
        { type: 'custom', label: 'Company anniversary', date: '2018-09-01' },
      ],
      linkedIn: 'https://linkedin.com/in/byewind',
      notes: 'Primary engineering contact for advisory portal work.',
      projects: '75',
      workingGroup: '23',
      likes: '1,123',
    },
    andi: {
      firstName: 'Andi',
      lastName: 'Lane',
      nickname: 'Andi',
      phones: [{ type: 'mobile', value: '+1 555 0101' }],
      emails: [{ type: 'work', value: 'andi@example.com' }],
      work: { jobTitle: 'Designer', department: 'Product Design', company: 'TM ANTOINE' },
      addresses: [{ type: 'home', street: '', city: 'LA, California', state: '', zip: '', country: 'USA' }],
      website: 'https://andilane.design',
      linkedIn: 'https://linkedin.com/in/andilane',
      socials: [
        { type: 'twitter', value: 'https://twitter.com/andilane' },
        { type: 'instagram', value: 'https://instagram.com/andilane' },
      ],
      importantDates: [{ type: 'birthday', label: '', date: '1991-04-22' }],
      notes: 'Design lead for TM ANTOINE. Best reached in the afternoon PST.',
      projects: '42',
      workingGroup: '18',
      likes: '890',
    },
    drew: {
      firstName: 'Drew',
      lastName: 'Cano',
      phones: [{ type: 'mobile', value: '+1 555 0102' }],
      emails: [{ type: 'work', value: 'drew@example.com' }],
      work: { jobTitle: 'Product Manager', department: 'Product', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Austin, TX', state: '', zip: '', country: 'USA' }],
      website: 'https://drewcano.com',
      linkedIn: 'https://linkedin.com/in/drewcano',
      socials: [{ type: 'twitter', value: 'https://twitter.com/drewcano' }],
      importantDates: [{ type: 'birthday', label: '', date: '1988-11-03' }],
      notes: 'Owns roadmap planning and stakeholder reviews.',
      projects: '31',
      workingGroup: '12',
      likes: '654',
    },
    bruce: {
      firstName: 'Bruce',
      lastName: 'Wayne',
      phones: [{ type: 'office', value: '+1 555 0199' }],
      emails: [{ type: 'work', value: 'bruce@wayneent.com' }],
      work: { jobTitle: 'Executive', department: 'Leadership', company: 'Wayne Enterprises' },
      addresses: [{ type: 'work', street: '1007 Mountain Drive', city: 'Gotham City', state: 'NJ', zip: '', country: 'USA' }],
      website: 'https://wayneenterprises.com',
      linkedIn: 'https://linkedin.com/in/brucewayne',
      socials: [{ type: 'twitter', value: 'https://twitter.com/wayneent' }],
      notes: 'Executive sponsor for enterprise accounts.',
      projects: '18',
      workingGroup: '6',
      likes: '2,401',
    },
    emma: {
      firstName: 'Emma',
      lastName: 'Smith',
      phones: [{ type: 'mobile', value: '+1 555 0114' }],
      emails: [{ type: 'work', value: 'emma@example.com' }],
      work: { jobTitle: 'Marketing Lead', department: 'Marketing', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Chicago, IL', state: '', zip: '', country: 'USA' }],
      projects: '29',
      workingGroup: '14',
      likes: '512',
    },
    john: {
      firstName: 'John',
      lastName: 'Smith',
      phones: [{ type: 'mobile', value: '+1 555 0122' }],
      emails: [{ type: 'work', value: 'john@example.com' }],
      work: { jobTitle: 'Engineer', department: 'Engineering', company: 'TM ANTOINE' },
      addresses: [{ type: 'home', street: '', city: 'Seattle, WA', state: '', zip: '', country: 'USA' }],
      projects: '36',
      workingGroup: '11',
      likes: '430',
    },
    kate: {
      firstName: 'Kate',
      lastName: 'Morrison',
      phones: [{ type: 'mobile', value: '+1 555 0133' }],
      emails: [{ type: 'work', value: 'kate@example.com' }],
      work: { jobTitle: 'Operations', department: 'Operations', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Denver, CO', state: '', zip: '', country: 'USA' }],
      website: 'https://katemorrison.io',
      linkedIn: 'https://linkedin.com/in/katemorrison',
      socials: [{ type: 'instagram', value: 'https://instagram.com/katemorrison' }],
      notes: 'Operations point of contact for CRM rollout.',
      projects: '22',
      workingGroup: '9',
      likes: '318',
    },
    koray: {
      firstName: 'Koray',
      lastName: 'Okumus',
      phones: [{ type: 'mobile', value: '+90 555 0100' }],
      emails: [{ type: 'work', value: 'koray@example.com' }],
      work: { jobTitle: 'Analyst', department: 'Strategy', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Istanbul', state: '', zip: '', country: 'Turkey' }],
      website: 'https://korayokumus.com',
      linkedIn: 'https://linkedin.com/in/korayokumus',
      socials: [{ type: 'twitter', value: 'https://twitter.com/korayokumus' }],
      notes: 'Strategy and research partner for search UX.',
      projects: '27',
      workingGroup: '10',
      likes: '275',
    },
    michael: {
      firstName: 'Michael',
      lastName: 'Brown',
      phones: [{ type: 'mobile', value: '+1 555 0144' }],
      emails: [{ type: 'work', value: 'michael@example.com' }],
      work: { jobTitle: 'Consultant', department: 'Advisory', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Boston, MA', state: '', zip: '', country: 'USA' }],
      projects: '19',
      workingGroup: '7',
      likes: '198',
    },
    melody: {
      firstName: 'Melody',
      lastName: 'Macy',
      phones: [{ type: 'mobile', value: '+1 555 0155' }],
      emails: [{ type: 'work', value: 'melody@example.com' }],
      work: { jobTitle: 'Creative Director', department: 'Creative', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Portland, OR', state: '', zip: '', country: 'USA' }],
      projects: '33',
      workingGroup: '15',
      likes: '621',
    },
    natali: {
      firstName: 'Natali',
      lastName: 'Craig',
      nickname: 'Nat',
      phones: [
        { type: 'mobile', value: '+1 555 0166' },
        { type: 'office', value: '+1 555 2800' },
      ],
      emails: [
        { type: 'work', value: 'natali@example.com' },
        { type: 'personal', value: 'natalicraig@example.com' },
      ],
      work: { jobTitle: 'Support Lead', department: 'Support', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Miami, FL', state: '', zip: '', country: 'USA' }],
      website: 'https://natalicraig.com',
      linkedIn: 'https://linkedin.com/in/natali-craig',
      socials: [
        { type: 'twitter', value: 'https://twitter.com/natalicraig' },
        { type: 'instagram', value: 'https://instagram.com/natalicraig' },
        { type: 'threads', value: 'https://threads.net/@natalicraig' },
      ],
      importantDates: [{ type: 'birthday', label: '', date: '1992-06-14' }],
      notes: 'Primary support contact. Prefers messages during business hours.',
      projects: '24',
      workingGroup: '13',
      likes: '402',
    },
    orlando: {
      firstName: 'Orlando',
      lastName: 'Diggs',
      phones: [{ type: 'mobile', value: '+1 555 0177' }],
      emails: [{ type: 'work', value: 'orlando@example.com' }],
      work: { jobTitle: 'Sales Manager', department: 'Sales', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Atlanta, GA', state: '', zip: '', country: 'USA' }],
      website: 'https://orlandodiggs.com',
      linkedIn: 'https://linkedin.com/in/orlandodiggs',
      socials: [{ type: 'twitter', value: 'https://twitter.com/orlandodiggs' }],
      notes: 'Sales lead for mid-market accounts.',
      projects: '28',
      workingGroup: '16',
      likes: '367',
    },
    william: {
      firstName: 'William',
      lastName: 'Johnson',
      phones: [{ type: 'mobile', value: '+1 555 0188' }],
      emails: [{ type: 'work', value: 'william@example.com' }],
      work: { jobTitle: 'Account Manager', department: 'Sales', company: 'TM ANTOINE' },
      addresses: [{ type: 'work', street: '', city: 'Phoenix, AZ', state: '', zip: '', country: 'USA' }],
      website: 'https://williamjohnson.co',
      linkedIn: 'https://linkedin.com/in/williamjohnson',
      notes: 'Account manager for advisory portal clients.',
      projects: '16',
      workingGroup: '8',
      likes: '210',
    },
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function cloneDraft(draft) {
    return JSON.parse(JSON.stringify(draft));
  }

  function emptyPhone(type) {
    return { type: type || 'mobile', value: '' };
  }

  function emptyEmail() {
    return { type: 'work', value: '' };
  }

  function emptyAddress() {
    return { type: 'work', street: '', city: '', state: '', zip: '', country: '' };
  }

  function emptyDate(type) {
    return { type: type || 'birthday', label: '', date: '' };
  }

  function emptyDraft() {
    return {
      firstName: '',
      middleName: '',
      lastName: '',
      nickname: '',
      photo: '',
      phones: [emptyPhone('mobile'), emptyPhone('office')],
      emails: [emptyEmail()],
      work: { jobTitle: '', department: '', company: '' },
      addresses: [emptyAddress()],
      importantDates: [emptyDate('birthday')],
      website: '',
      linkedIn: '',
      notes: '',
    };
  }

  function legacyToContact(item, extra) {
    extra = extra || {};
    var parts = String(item.name || '').trim().split(/\s+/);
    return {
      firstName: extra.firstName || parts[0] || '',
      middleName: extra.middleName || '',
      lastName: extra.lastName || parts.slice(1).join(' ') || '',
      nickname: extra.nickname || '',
      phones: extra.phones || [{ type: 'mobile', value: extra.phone || '' }],
      emails: extra.emails || [{ type: 'work', value: extra.email || '' }],
      work: extra.work || {
        jobTitle: extra.role || 'Team member',
        department: extra.department || '',
        company: extra.company || '',
      },
      addresses: extra.addresses || [
        { type: 'work', street: '', city: extra.location || 'Remote', state: '', zip: '', country: '' },
      ],
      website: extra.website || '',
      photo: extra.photo || '',
      importantDates: extra.importantDates || [],
      birthday: extra.birthday || '',
      linkedIn: extra.linkedIn || '',
      socials: extra.socials || [],
      notes: extra.notes || '',
      projects: extra.projects || '12',
      workingGroup: extra.workingGroup || '8',
      likes: extra.likes || '240',
    };
  }

  function directoryItemFor(id) {
    for (var i = 0; i < DIRECTORY.length; i++) {
      for (var j = 0; j < DIRECTORY[i].items.length; j++) {
        if (DIRECTORY[i].items[j].id === id) return DIRECTORY[i].items[j];
      }
    }
    return null;
  }

  function displayName(contact) {
    var parts = [contact.firstName, contact.middleName, contact.lastName].filter(Boolean);
    if (parts.length) return parts.join(' ');
    return contact.name || 'Client';
  }

  function normalizeImportantDates(contact) {
    var dates = (contact.importantDates || []).slice();
    if (!dates.length && contact.birthday) {
      dates.push({ type: 'birthday', label: '', date: contact.birthday });
    }
    return dates;
  }

  function avatarSource(item) {
    if (item.photo) return { kind: 'photo', src: item.photo };
    if (item.avatar) return { kind: 'avatar', src: AVATAR + item.avatar + '.png' };
    return { kind: 'initial', initial: item.initial, color: item.initialColor };
  }

  function contactFor(id) {
    var item = directoryItemFor(id) || directoryItemFor('byewind');
    var extra = PROFILES[item.id] || {};
    var contact = legacyToContact(item, extra);
    contact.id = item.id;
    contact.name = displayName(contact);
    contact.avatar = item.avatar;
    contact.initial = item.initial;
    contact.initialColor = item.initialColor;
    contact.importantDates = normalizeImportantDates(contact);
    contact.socials = extra.socials || [];
    return contact;
  }

  function contactToDraft(contact) {
    var dates = normalizeImportantDates(contact);
    return cloneDraft({
      firstName: contact.firstName,
      middleName: contact.middleName,
      lastName: contact.lastName,
      nickname: contact.nickname,
      photo: contact.photo || '',
      phones: contact.phones.length ? contact.phones : [emptyPhone()],
      emails: contact.emails.length ? contact.emails : [emptyEmail()],
      work: contact.work || { jobTitle: '', department: '', company: '' },
      addresses: contact.addresses.length ? contact.addresses : [emptyAddress()],
      importantDates: dates.length ? dates : [emptyDate('birthday')],
      website: contact.website || '',
      linkedIn: contact.linkedIn || '',
      notes: contact.notes || '',
    });
  }

  function formatAddress(addr) {
    return [addr.street, addr.city, addr.state, addr.zip, addr.country].filter(Boolean).join(', ');
  }

  function phoneTypeLabel(type) {
    var match = PHONE_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function emailTypeLabel(type) {
    var match = EMAIL_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function addressTypeLabel(type) {
    var match = ADDRESS_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function dateTypeLabel(type) {
    var match = DATE_TYPES.filter(function (t) { return t.value === type; })[0];
    return match ? match.label : type;
  }

  function dateEntryLabel(entry) {
    if (entry.type === 'custom' && entry.label) return entry.label;
    return dateTypeLabel(entry.type);
  }

  function formatDateDisplay(iso) {
    if (!iso) return '';
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function telHref(phone) {
    return 'tel:' + String(phone).replace(/[^\d+]/g, '');
  }

  function mapsHref(address) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(formatAddress(address));
  }

  function renderAvatar(item, size) {
    size = size || 24;
    var source = avatarSource(item);
    if (source.kind === 'photo' || source.kind === 'avatar') {
      return (
        '<span class="tma-dash__clients-avatar" style="width:' + size + 'px;height:' + size + 'px">' +
        '<img src="' + esc(source.src) + '" alt="">' +
        '</span>'
      );
    }
    var colorClass = source.color === 'green' ? ' tma-dash__clients-avatar--green' : ' tma-dash__clients-avatar--blue';
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial' + colorClass +
      '" style="width:' + size + 'px;height:' + size + 'px">' + esc(source.initial) + '</span>'
    );
  }

  function directoryAvatarItem(item) {
    var profile = PROFILES[item.id] || {};
    return {
      avatar: item.avatar,
      initial: item.initial,
      initialColor: item.initialColor,
      photo: profile.photo || '',
    };
  }

  var CONTACTS_MOBILE_BP = 1024;

  function isClientsMobile() {
    return window.innerWidth <= CONTACTS_MOBILE_BP;
  }

  function usesTableFullPage(state) {
    return state.viewMode === 'list';
  }

  function usesPagedClientsFlow(state) {
    return isClientsMobile() || usesTableFullPage(state);
  }

  function parseClientsPath(pathname) {
    var p = String(pathname || '').replace(/\/+$/, '') || '/';
    if (p === '/clients' || p === '/user-profile/clients') {
      return { screen: 'list' };
    }
    if (p === '/clients/new') {
      return { screen: 'add' };
    }
    var editMatch = p.match(/^\/clients\/([^/]+)\/edit$/);
    if (editMatch) {
      return { screen: 'edit', contactId: decodeURIComponent(editMatch[1]) };
    }
    var detailMatch = p.match(/^\/clients\/([^/]+)$/);
    if (detailMatch) {
      return { screen: 'detail', contactId: decodeURIComponent(detailMatch[1]) };
    }
    if (p === '/contacts' || p === '/user-profile/contacts') {
      return { screen: 'list', legacyRedirect: true };
    }
    if (p === '/contacts/new') {
      return { screen: 'add', legacyRedirect: true };
    }
    var legacyEditMatch = p.match(/^\/contacts\/([^/]+)\/edit$/);
    if (legacyEditMatch) {
      return { screen: 'edit', contactId: decodeURIComponent(legacyEditMatch[1]), legacyRedirect: true };
    }
    var legacyDetailMatch = p.match(/^\/contacts\/([^/]+)$/);
    if (legacyDetailMatch) {
      return { screen: 'detail', contactId: decodeURIComponent(legacyDetailMatch[1]), legacyRedirect: true };
    }
    return null;
  }

  function pathForClientsScreen(screen, contactId) {
    if (screen === 'add') return '/clients/new';
    if (screen === 'edit' && contactId) {
      return '/clients/' + encodeURIComponent(contactId) + '/edit';
    }
    if (screen === 'detail' && contactId) {
      return '/clients/' + encodeURIComponent(contactId);
    }
    return '/clients';
  }

  function contactMatchesSearch(item, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    if (item.name.toLowerCase().indexOf(q) !== -1) return true;
    var profile = PROFILES[item.id];
    if (!profile) return false;
    var parts = [
      profile.firstName,
      profile.lastName,
      profile.nickname,
      profile.work && profile.work.company,
      profile.work && profile.work.jobTitle,
    ];
    (profile.emails || []).forEach(function (email) { if (email.value) parts.push(email.value); });
    (profile.phones || []).forEach(function (phone) { if (phone.value) parts.push(phone.value); });
    return parts.filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
  }

  function filteredDirectoryGroups(search) {
    var q = String(search || '').trim();
    if (!q) return DIRECTORY;
    return DIRECTORY.map(function (group) {
      var items = group.items.filter(function (item) {
        return contactMatchesSearch(item, q);
      });
      if (!items.length) return null;
      return { letter: group.letter, items: items };
    }).filter(Boolean);
  }

  function filteredDirectoryItems(state) {
    var search = typeof state === 'string' ? state : (state && state.search);
    var removedIds = state && typeof state === 'object' ? state.removedIds : null;
    var items = [];
    filteredDirectoryGroups(search).forEach(function (group) {
      group.items.forEach(function (item) {
        if (removedIds && removedIds[clientRowKey(item)]) return;
        items.push(item);
      });
    });
    return items;
  }

  function loadViewMode() {
    try {
      var saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'table') saved = 'list';
      if (saved === 'directory') saved = 'grid';
      if (saved === 'list' || saved === 'grid') return saved;
    } catch (e) { /* ignore */ }
    return 'list';
  }

  function saveViewMode(mode) {
    try {
      localStorage.setItem(VIEW_KEY, mode === 'list' ? 'list' : 'grid');
    } catch (e) { /* ignore */ }
  }

  function registerViewToggle(entry) {
    if (!window.TMATableViewToggle || !entry) return;
    window.TMATableViewToggle.register('clients', {
      getViewMode: function () { return entry.state.viewMode; },
      setViewMode: function (mode) {
        entry.state.viewMode = mode === 'list' ? 'list' : 'grid';
        saveViewMode(entry.state.viewMode);
        if (entry.state.viewMode === 'list') {
          entry.state.screen = 'list';
          entry.state.page = 1;
          if (!isClientsMobile()) {
            history.replaceState(
              {
                navId: 'clients',
                view: 'clients',
                title: 'Clients',
                crumb: 'Clients',
                clientsScreen: 'list',
                contactId: entry.state.selectedId || null,
              },
              '',
              '/clients'
            );
            if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
              window.TMADashboard.updatePageMeta({ title: 'Clients', crumb: 'Clients' });
            }
          }
        }
      },
      render: function () { entry.render({ forceFull: true }); },
    });
  }

  function primaryContactValue(id) {
    var profile = PROFILES[id];
    if (!profile) return '—';
    var emails = profile.emails || [];
    for (var i = 0; i < emails.length; i++) {
      if (emails[i].value) return emails[i].value;
    }
    var phones = profile.phones || [];
    for (var j = 0; j < phones.length; j++) {
      if (phones[j].value) return phones[j].value;
    }
    return '—';
  }

  function clientTableColumns(item) {
    var profile = PROFILES[item.id] || {};
    var company = profile.work && profile.work.company;
    if (company) {
      return { name: company, primaryContact: item.name };
    }
    return { name: item.name, primaryContact: primaryContactValue(item.id) };
  }

  function clientRowKey(item) {
    return item.id;
  }

  function clientAvatarMarkup(item) {
    var av = directoryAvatarItem(item);
    if (av.avatar) {
      return '<img src="' + esc(AVATAR + av.avatar + '.png') + '" alt="">';
    }
    if (av.photo) {
      return '<img src="' + esc(av.photo) + '" alt="">';
    }
    var colorClass = av.initialColor === 'green' ? ' tma-dash__clients-avatar--green' : ' tma-dash__clients-avatar--blue';
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial' + colorClass +
      '" style="width:var(--dash-icon-lg);height:var(--dash-icon-lg)">' + esc(av.initial || '?') + '</span>'
    );
  }

  function selectedClientCount(state) {
    return Object.keys(state.selected || {}).length;
  }

  function renderClientsHeadActions() {
    return (
      '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap>' +
      '<button type="button" class="tma-dash__head-dropdown-btn tma-dash__head-dropdown-btn--secondary" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false">' +
      'Manage client hub' +
      '<img class="tma-dash__head-dropdown-caret" src="' + ICONS.ArrowLineDown + '" alt="" aria-hidden="true">' +
      '</button>' +
      '<div class="tma-dash__menu tma-dash__head-dropdown-menu tma-dash__head-dropdown-menu--start" data-head-dropdown-menu hidden role="menu" aria-label="Manage client hub">' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:clienthub-access">Manage client hub access</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:service-teams">Manage service teams</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="admin:custom-fields">Manage custom fields</button>' +
      '</div></div>' +
      '<div class="tma-dash__head-dropdown-wrap" data-head-dropdown-wrap>' +
      '<button type="button" class="tma-dash__head-dropdown-btn tma-dash__head-dropdown-btn--primary" data-head-dropdown-toggle aria-haspopup="menu" aria-expanded="false">' +
      'Create client' +
      '<img class="tma-dash__head-dropdown-caret" src="' + ICONS.ArrowLineDown + '" alt="" aria-hidden="true">' +
      '</button>' +
      '<div class="tma-dash__menu tma-dash__head-dropdown-menu tma-dash__head-dropdown-menu--end" data-head-dropdown-menu hidden role="menu" aria-label="Create client">' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="create-new">Create new</button>' +
      '<button type="button" class="tma-dash__menu-item" role="menuitem" data-head-dropdown-item="create-import">Import clients</button>' +
      '</div>' +
      '<input type="file" accept=".csv,.xlsx,.xls" class="tma-dash__clients-import-input" data-clients-import-input hidden aria-hidden="true">' +
      '</div>'
    );
  }

  function syncClientsPageActions(state, navigate) {
    var slot = document.querySelector('[data-clients-page-actions]');
    if (!slot) return;
    clientsHeadActionsNavigate = navigate;
    ensureClientsHeadActionsWiring();
    var show = state.screen === 'list';
    slot.hidden = !show;
    if (!show) {
      slot.innerHTML = '';
      if (window.TMAHeadDropdown) window.TMAHeadDropdown.closeAll();
      return;
    }
    if (!slot.querySelector('[data-head-dropdown-toggle]')) {
      slot.innerHTML = renderClientsHeadActions();
    }
  }

  function renderBulkToolBtn(action, icon, label) {
    return (
      '<button type="button" class="tma-dash__tool-btn" aria-label="' + esc(label) + '" data-clients-bulk-action="' + action + '">' +
      '<img src="' + icon + '" alt=""></button>'
    );
  }

  function renderTableToolbar(state) {
    var count = selectedClientCount(state);
    var bulkHidden = count === 0 ? ' hidden' : '';
    var selectionLabel = count === 1 ? '1 Selected' : count + ' Selected';

    return (
      '<div class="tma-dash__toolbar' + (count > 0 ? ' tma-dash__toolbar--selected' : '') + '">' +
      '<div class="tma-dash__toolbar-actions">' +
      '<button type="button" class="tma-dash__tool-btn" aria-label="Filter" data-clients-filter aria-pressed="false">' +
      '<img src="' + ICONS.FunnelSimple + '" alt=""></button>' +
      '<button type="button" class="tma-dash__tool-btn" aria-label="Sort" data-clients-sort aria-pressed="false">' +
      '<img src="' + ICONS.ArrowsDownUp + '" alt=""></button>' +
      '<div class="tma-dash__toolbar-bulk" data-clients-bulk' + bulkHidden + '>' +
      '<img class="tma-dash__toolbar-divider" src="' + ICONS.Line + '" alt="" aria-hidden="true">' +
      '<span class="tma-dash__toolbar-selection" data-clients-selection-count aria-live="polite">' + selectionLabel + '</span>' +
      renderBulkToolBtn('delete', ICONS.Trash, 'Delete selected clients') +
      renderBulkToolBtn('duplicate', ICONS.Copy, 'Duplicate selected clients') +
      '</div></div>' +
      renderTableSearchField(state) +
      '</div>'
    );
  }

  function updateTableToolbarSelection(root, state) {
    var count = selectedClientCount(state);
    var bulk = root.querySelector('[data-clients-bulk]');
    var label = root.querySelector('[data-clients-selection-count]');
    var toolbar = root.querySelector('.tma-dash__toolbar');
    if (!bulk || !label || !toolbar) return;
    bulk.hidden = count === 0;
    toolbar.classList.toggle('tma-dash__toolbar--selected', count > 0);
    label.textContent = count === 1 ? '1 Selected' : count + ' Selected';
  }
  function renderSearchField(state) {
    var search = state.search || '';
    var cls = 'tma-dash__clients-search';
    if (state.searchFocused || search) cls += ' tma-dash__clients-search--focused';
    if (search) cls += ' tma-dash__clients-search--has-value';
    if (state.searchLoading) cls += ' tma-dash__clients-search--loading';

    return (
      '<div class="' + cls + '" role="search" data-clients-search-wrap>' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="">' +
      '<input type="search" class="tma-dash__clients-search-input" data-clients-search value="' + esc(search) +
      '" placeholder="Search" aria-label="Search clients" autocomplete="off">' +
      '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-clients-search-clear>' +
      '<img src="' + ICONS.XCircle + '" alt=""></button>' +
      '<span class="tma-dash__search-spinner" aria-hidden="true"><img src="' + ICONS.Loading16 + '" alt=""></span>' +
      '<kbd class="tma-dash__kbd" data-clients-search-shortcut aria-hidden="true">/</kbd>' +
      '</div>'
    );
  }

  function renderTableSearchField(state) {
    var search = state.search || '';
    var cls = 'tma-dash__toolbar-search';
    if (state.searchFocused || search) cls += ' tma-dash__toolbar-search--focused';
    if (search) cls += ' tma-dash__toolbar-search--has-value';
    if (state.searchLoading) cls += ' tma-dash__toolbar-search--loading';
    var kbd = search ? '' : '<kbd class="tma-dash__kbd" data-clients-search-shortcut aria-hidden="true">/</kbd>';

    return (
      '<div class="' + cls + '" role="search" data-clients-search-wrap>' +
      '<img src="' + ICONS.Search + '" alt="">' +
      '<input type="search" class="tma-dash__search-input" data-clients-search value="' + esc(search) +
      '" placeholder="Search" aria-label="Search table" autocomplete="off" spellcheck="false">' +
      '<button type="button" class="tma-dash__search-clear" aria-label="Clear search" data-clients-search-clear>' +
      '<img src="' + ICONS.XCircle + '" alt=""></button>' +
      '<span class="tma-dash__search-spinner" aria-hidden="true"><img src="' + ICONS.Loading16 + '" alt=""></span>' +
      kbd +
      '</div>'
    );
  }

  var CLIENTS_PAGE_SIZES = [5, 10, 20];

  function getTablePageData(state) {
    var items = filteredDirectoryItems(state);
    var pageSize = state.pageSize || 10;
    var totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      total: items.length,
      totalPages: totalPages,
    };
  }

  function renderFullTableRow(item, index, checked) {
    var cols = clientTableColumns(item);
    var selected = checked ? ' tma-dash__ctr--selected' : '';
    return (
      '<div class="tma-dash__ctr tma-dash__ctr--body' + selected + '" data-clients-row="' + esc(item.id) +
      '" data-row-index="' + index + '" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check">' +
      '<input type="checkbox" class="tma-dash__check" data-clients-check' + (checked ? ' checked' : '') +
      ' aria-label="Select ' + esc(cols.name) + '"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--user">' + clientAvatarMarkup(item) +
      '<span class="tma-dash__cc-truncate">' + esc(cols.name) + '</span></div>' +
      '<div class="tma-dash__cc tma-dash__cc--contact"><span class="tma-dash__cc-truncate">' +
      esc(cols.primaryContact) + '</span></div></div>'
    );
  }

  function renderFullTableRows(state) {
    var page = getTablePageData(state);
    if (!page.items.length) {
      return '<div class="tma-dash__ctr tma-dash__ctr--empty" role="row"><div class="tma-dash__cc tma-dash__cc--empty">No clients found</div></div>';
    }
    var start = (state.page - 1) * (state.pageSize || 10);
    return page.items.map(function (item, i) {
      var key = clientRowKey(item);
      return renderFullTableRow(item, start + i, !!(state.selected && state.selected[key]));
    }).join('');
  }

  function renderClientsPagination(state, totalRows) {
    var pageSize = state.pageSize || 10;
    var totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    if (state.page > totalPages) state.page = totalPages;

    var pages = '';
    var maxButtons = Math.min(5, totalPages);
    for (var p = 1; p <= maxButtons; p++) {
      var active = p === state.page;
      pages +=
        '<button type="button" class="tma-pagination__button' + (active ? ' tma-pagination__button--active' : '') +
        '" aria-label="Page ' + p + '"' + (active ? ' aria-current="page"' : '') +
        ' data-page="' + p + '"><span class="tma-pagination__label">' + p + '</span></button>';
    }

    var prevDisabled = state.page <= 1 ? ' disabled' : '';
    var nextDisabled = state.page >= totalPages ? ' disabled' : '';
    var resultsText = totalRows + (totalRows === 1 ? ' result' : ' results');

    return (
      '<div class="tma-pagination-bar tma-pagination-bar--footer" data-clients-pagination>' +
      '<div class="tma-pagination-bar__meta">' +
      '<button type="button" class="tma-pagination-bar__page-size" aria-label="Rows per page" aria-haspopup="listbox" aria-expanded="false" data-clients-page-size>' +
      '<span class="tma-pagination__label">' + pageSize + '</span>' +
      '<img src="' + ICONS.ArrowLineDown + '" class="tma-pagination__icon" width="16" height="16" alt="" aria-hidden="true">' +
      '</button>' +
      '<span class="tma-pagination-bar__results" data-clients-results-count>' + resultsText + '</span>' +
      '</div>' +
      '<nav class="tma-pagination" aria-label="Pagination">' + pages +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon" aria-label="Previous page" data-direction="prev"' + prevDisabled + '>' +
      '<img src="' + ICONS.ArrowLineLeft + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '<button type="button" class="tma-pagination__button tma-pagination__button--icon tma-pagination__button--next" aria-label="Next page" data-direction="next"' + nextDisabled + '>' +
      '<img src="' + ICONS.ArrowLineRight + '" class="tma-pagination__icon" width="16" height="16" alt=""></button>' +
      '</nav></div>'
    );
  }

  function renderTableListPage(state) {
    var page = getTablePageData(state);
    return (
      renderTableToolbar(state) +
      '<div class="tma-dash__ctable" role="table" aria-label="Clients">' +
      '<div class="tma-dash__ctr tma-dash__ctr--head" role="row">' +
      '<div class="tma-dash__cc tma-dash__cc--check tma-dash__cc--head">' +
      '<input type="checkbox" class="tma-dash__check" data-clients-selectall aria-label="Select all"></div>' +
      '<div class="tma-dash__cc tma-dash__cc--user tma-dash__cc--head" role="columnheader">Name</div>' +
      '<div class="tma-dash__cc tma-dash__cc--contact tma-dash__cc--head" role="columnheader">Primary contact</div>' +
      '</div>' +
      '<div data-clients-body>' + renderFullTableRows(state) + '</div>' +
      '</div>' +
      renderClientsPagination(state, page.total)
    );
  }
  function renderDirectoryListBody(state) {
    var groups = filteredDirectoryGroups(state.search);
    if (!groups.length) {
      return '<div class="tma-dash__clients-directory-empty">No clients found</div>';
    }
    return groups.map(function (group) {
      return (
        '<div class="tma-dash__clients-letter">' + esc(group.letter) + '</div>' +
        group.items.map(function (item) {
          var active = state.selectedId === item.id;
          return (
            '<button type="button" class="tma-dash__clients-row' + (active ? ' tma-dash__clients-row--active' : '') +
            '" data-clients-row="' + esc(item.id) + '">' +
            renderAvatar(directoryAvatarItem(item)) +
            '<span class="tma-dash__clients-row-name">' + esc(item.name) + '</span>' +
            '</button>'
          );
        }).join('')
      );
    }).join('');
  }

  function renderDirectoryBody(state) {
    return renderDirectoryListBody(state);
  }

  function renderDirectoryHead(state) {
    return (
      '<div class="tma-dash__clients-directory-head">' +
      renderSearchField(state) +
      '</div>'
    );
  }

  function renderDirectory(state, standalone) {
    var standaloneClass = standalone !== false ? ' tma-dash__clients-directory--standalone' : '';
    return (
      '<div class="tma-dash__clients-directory' + standaloneClass + '">' +
      renderDirectoryHead(state) +
      '<div class="tma-dash__clients-directory-body">' +
      renderDirectoryBody(state) +
      '</div></div>'
    );
  }

  function renderListPage(state) {
    return (
      '<div class="tma-dash__clients-page tma-dash__clients-page--list" data-node-id="clients-page">' +
      renderDirectory(state, true) +
      '</div>'
    );
  }

  function renderDesktopPage(state) {
    return (
      '<div class="tma-dash__clients-page" data-node-id="clients-page">' +
      renderDirectory(state, false) +
      (state.adding || state.editing ? renderContactFormPanel(state) : renderProfile(state)) +
      '</div>'
    );
  }

  function renderDetailBackBar() {
    return (
      '<div class="tma-dash__clients-page-head">' +
      '<button type="button" class="tma-dash__clients-back-btn" data-clients-back aria-label="Back to clients">' +
      '<img src="' + ICONS.CaretLeft + '" alt="" aria-hidden="true">' +
      '<span>Clients</span>' +
      '</button></div>'
    );
  }

  function renderDetailPage(state) {
    return (
      '<div class="tma-dash__clients-page tma-dash__clients-page--detail" data-node-id="clients-page">' +
      renderDetailBackBar() +
      (state.adding || state.editing ? renderContactFormPanel(state) : renderProfile(state)) +
      '</div>'
    );
  }

  function renderSelectOptions(types, selected) {
    return types.map(function (t) {
      return '<option value="' + esc(t.value) + '"' + (t.value === selected ? ' selected' : '') + '>' + esc(t.label) + '</option>';
    }).join('');
  }

  function renderFormField(label, field, value, opts) {
    opts = opts || {};
    return (
      '<label class="tma-dash__clients-form-field">' +
      '<span class="tma-dash__clients-form-label">' + esc(label) + '</span>' +
      '<input type="' + esc(opts.type || 'text') + '" class="tma-dash__clients-field-input" data-clients-field="' +
      esc(field) + '" value="' + esc(value || '') + '"' + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>' +
      '</label>'
    );
  }

  function renderFormSection(title, content) {
    return (
      '<section class="tma-dash__clients-form-section">' +
      '<h3 class="tma-dash__clients-form-section-title">' + esc(title) + '</h3>' +
      content +
      '</section>'
    );
  }

  function renderPhoneRows(phones) {
    return phones.map(function (phone, i) {
      return (
        '<div class="tma-dash__clients-form-row" data-clients-phone-row="' + i + '">' +
        '<select class="tma-dash__clients-field-select" data-clients-phone-type="' + i + '">' +
        renderSelectOptions(PHONE_TYPES, phone.type) +
        '</select>' +
        '<input type="tel" class="tma-dash__clients-field-input" data-clients-phone-value="' + i +
        '" value="' + esc(phone.value) + '" placeholder="Phone number">' +
        '<button type="button" class="tma-dash__clients-row-remove" data-clients-remove="phones" data-clients-index="' + i +
        '" aria-label="Remove phone"' + (phones.length === 1 ? ' disabled' : '') + '>' +
        '<img src="' + ICONS.Trash + '" alt=""></button></div>'
      );
    }).join('');
  }

  function renderEmailRows(emails) {
    return emails.map(function (email, i) {
      return (
        '<div class="tma-dash__clients-form-row" data-clients-email-row="' + i + '">' +
        '<select class="tma-dash__clients-field-select" data-clients-email-type="' + i + '">' +
        renderSelectOptions(EMAIL_TYPES, email.type) +
        '</select>' +
        '<input type="email" class="tma-dash__clients-field-input" data-clients-email-value="' + i +
        '" value="' + esc(email.value) + '" placeholder="Email address">' +
        '<button type="button" class="tma-dash__clients-row-remove" data-clients-remove="emails" data-clients-index="' + i +
        '" aria-label="Remove email"' + (emails.length === 1 ? ' disabled' : '') + '>' +
        '<img src="' + ICONS.Trash + '" alt=""></button></div>'
      );
    }).join('');
  }

  function renderAddressBlocks(addresses) {
    return addresses.map(function (addr, i) {
      return (
        '<div class="tma-dash__clients-address-block" data-clients-address-row="' + i + '">' +
        '<div class="tma-dash__clients-address-block-head">' +
        '<select class="tma-dash__clients-field-select" data-clients-address-type="' + i + '">' +
        renderSelectOptions(ADDRESS_TYPES, addr.type) +
        '</select>' +
        '<button type="button" class="tma-dash__clients-row-remove" data-clients-remove="addresses" data-clients-index="' + i +
        '" aria-label="Remove address"' + (addresses.length === 1 ? ' disabled' : '') + '>' +
        '<img src="' + ICONS.Trash + '" alt=""></button></div>' +
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('Street', 'address-street-' + i, addr.street, { placeholder: 'Street address' }) +
        renderFormField('City', 'address-city-' + i, addr.city, { placeholder: 'City' }) +
        renderFormField('State / Province', 'address-state-' + i, addr.state, { placeholder: 'State' }) +
        renderFormField('ZIP / Postal code', 'address-zip-' + i, addr.zip, { placeholder: 'ZIP' }) +
        renderFormField('Country', 'address-country-' + i, addr.country, { placeholder: 'Country' }) +
        '</div></div>'
      );
    }).join('');
  }

  function renderAddGroupButton(group, label) {
    return (
      '<button type="button" class="tma-dash__clients-add-group" data-clients-add-group="' + esc(group) + '">' +
      '<img src="' + ICONS.Plus + '" alt=""><span>' + esc(label) + '</span></button>'
    );
  }

  function renderDateRows(dates) {
    return dates.map(function (entry, i) {
      var isCustom = entry.type === 'custom';
      return (
        '<div class="tma-dash__clients-form-row tma-dash__clients-form-row--dates" data-clients-date-row="' + i + '">' +
        '<select class="tma-dash__clients-field-select" data-clients-date-type="' + i + '">' +
        renderSelectOptions(DATE_TYPES, entry.type) +
        '</select>' +
        '<input type="text" class="tma-dash__clients-field-input tma-dash__clients-date-label' +
        (isCustom ? '' : ' tma-dash__clients-date-label--hidden') + '" data-clients-date-label="' + i +
        '" value="' + esc(entry.label) + '" placeholder="Custom label"' + (isCustom ? '' : ' disabled') + '>' +
        '<input type="date" class="tma-dash__clients-field-input" data-clients-date-value="' + i +
        '" value="' + esc(entry.date) + '">' +
        '<button type="button" class="tma-dash__clients-row-remove" data-clients-remove="importantDates" data-clients-index="' + i +
        '" aria-label="Remove date"' + (dates.length === 1 ? ' disabled' : '') + '>' +
        '<img src="' + ICONS.Trash + '" alt=""></button></div>'
      );
    }).join('');
  }

  function renderPhotoField(draft) {
    var hasPhoto = !!draft.photo;
    return (
      '<div class="tma-dash__clients-photo">' +
      '<input type="file" accept="image/*" class="tma-dash__clients-photo-input" data-clients-photo-input aria-hidden="true">' +
      '<div class="tma-dash__clients-photo-wrap">' +
      '<button type="button" class="tma-dash__clients-photo-btn"' + (hasPhoto ? ' data-has-image="true"' : '') + ' data-clients-photo-btn>' +
      '<img src="' + ICONS.User + '" alt="" class="tma-dash__clients-photo-placeholder" width="40" height="40">' +
      '<img alt="" class="tma-dash__clients-photo-preview" data-clients-photo-preview width="80" height="80"' +
      (hasPhoto ? ' src="' + esc(draft.photo) + '"' : '') + '>' +
      '</button>' +
      '<button type="button" class="tma-dash__clients-photo-remove" data-clients-photo-remove aria-label="Remove photo">' +
      '<img src="' + ICONS.XCircle + '" alt="" class="tma-dash__clients-photo-remove-icon" width="20" height="20">' +
      '</button></div>' +
      '<p class="tma-dash__clients-photo-hint">Upload a photo for this client. JPG or PNG recommended.</p>' +
      '</div>'
    );
  }

  function renderFormHeadAvatar(draft, contact, isNew) {
    if (draft.photo) {
      return (
        '<span class="tma-dash__clients-avatar" style="width:40px;height:40px">' +
        '<img src="' + esc(draft.photo) + '" alt="">' +
        '</span>'
      );
    }
    if (!isNew && contact) return renderAvatar(contact, 40);
    var initial = draft.firstName ? draft.firstName.charAt(0).toUpperCase() : '+';
    return (
      '<span class="tma-dash__clients-avatar tma-dash__clients-avatar--initial tma-dash__clients-avatar--blue" style="width:40px;height:40px">' +
      esc(initial) + '</span>'
    );
  }

  function renderContactForm(draft) {
    return (
      '<form class="tma-dash__clients-form" data-clients-form novalidate>' +
      renderFormSection('Photo', renderPhotoField(draft)) +
      renderFormSection(
        'Name',
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('First name', 'firstName', draft.firstName) +
        renderFormField('Middle name', 'middleName', draft.middleName) +
        renderFormField('Last name', 'lastName', draft.lastName) +
        renderFormField('Nickname', 'nickname', draft.nickname) +
        '</div>'
      ) +
      renderFormSection(
        'Phone numbers',
        '<div class="tma-dash__clients-form-rows" data-clients-phones>' + renderPhoneRows(draft.phones) + '</div>' +
        renderAddGroupButton('phones', 'Add phone number')
      ) +
      renderFormSection(
        'Email addresses',
        '<div class="tma-dash__clients-form-rows" data-clients-emails>' + renderEmailRows(draft.emails) + '</div>' +
        renderAddGroupButton('emails', 'Add email address')
      ) +
      renderFormSection(
        'Work',
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('Job title', 'jobTitle', draft.work.jobTitle) +
        renderFormField('Department', 'department', draft.work.department) +
        renderFormField('Company', 'company', draft.work.company) +
        '</div>'
      ) +
      renderFormSection(
        'Addresses',
        '<div class="tma-dash__clients-form-addresses" data-clients-addresses>' + renderAddressBlocks(draft.addresses) + '</div>' +
        renderAddGroupButton('addresses', 'Add address')
      ) +
      renderFormSection(
        'Important dates',
        '<div class="tma-dash__clients-form-rows" data-clients-dates>' + renderDateRows(draft.importantDates) + '</div>' +
        renderAddGroupButton('importantDates', 'Add date')
      ) +
      renderFormSection(
        'Additional',
        '<div class="tma-dash__clients-form-grid">' +
        renderFormField('Website', 'website', draft.website, { type: 'url', placeholder: 'https://' }) +
        renderFormField('LinkedIn', 'linkedIn', draft.linkedIn, { type: 'url', placeholder: 'https://linkedin.com/in/' }) +
        '</div>' +
        '<label class="tma-dash__clients-form-field tma-dash__clients-form-field--full">' +
        '<span class="tma-dash__clients-form-label">Notes</span>' +
        '<textarea class="tma-dash__clients-field-textarea" data-clients-field="notes" rows="4" placeholder="Add notes about this client">' +
        esc(draft.notes) +
        '</textarea></label>'
      ) +
      '</form>'
    );
  }

  function renderContactFormPanel(state) {
    var draft = state.draft || emptyDraft();
    var isNew = !!state.adding;
    var contact = isNew ? null : contactFor(state.selectedId);
    var title = isNew ? 'New client' : 'Edit client';
    var head = renderFormHeadAvatar(draft, contact, isNew);

    return (
      '<div class="tma-dash__clients-detail">' +
      '<div class="tma-dash__clients-profile tma-dash__clients-profile--form">' +
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' + head +
      '<span class="tma-dash__clients-profile-name">' + esc(title) + '</span></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-cancel>Cancel</button>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-save>' + (isNew ? 'Add' : 'Save') + '</button>' +
      '</div></div>' +
      renderContactForm(draft) +
      '</div></div>'
    );
  }

  function renderListItem(opts) {
    var valueHtml = opts.href
      ? '<a class="tma-dash__clients-list-value tma-dash__clients-list-link" href="' + esc(opts.href) +
        '" aria-label="' + esc(opts.linkLabel || opts.value) + '">' + esc(opts.value) + '</a>'
      : '<span class="tma-dash__clients-list-value">' + esc(opts.value) + '</span>';
    return (
      '<li class="tma-dash__clients-list-item">' +
      '<span class="tma-dash__clients-list-icon" aria-hidden="true"><img src="' + esc(opts.icon) + '" alt=""></span>' +
      '<div class="tma-dash__clients-list-main">' +
      '<span class="tma-dash__clients-list-label">' + esc(opts.label) + '</span>' + valueHtml +
      '</div></li>'
    );
  }

  function renderStat(label, value) {
    return (
      '<div class="tma-dash__clients-stat">' +
      '<span class="tma-dash__clients-stat-label">' + esc(label) + '</span>' +
      '<span class="tma-dash__clients-stat-value">' + esc(value) + '</span></div>'
    );
  }

  function splitListColumns(items, maxPerColumn) {
    maxPerColumn = maxPerColumn || 6;
    var columns = [[], []];
    items.forEach(function (item, i) {
      var columnIndex = Math.floor(i / maxPerColumn) % 2;
      columns[columnIndex].push(item);
    });
    return columns;
  }

  function renderProfileListColumns(listItems) {
    if (isClientsMobile()) {
      return (
        '<div class="tma-dash__clients-profile-body">' +
        '<ul class="tma-dash__clients-list tma-dash__clients-list--profile" role="list">' +
        listItems.join('') +
        '</ul></div>'
      );
    }
    var columns = splitListColumns(listItems, 6);
    return (
      '<div class="tma-dash__clients-profile-body">' +
      columns.map(function (columnItems) {
        return (
          '<ul class="tma-dash__clients-list tma-dash__clients-list--profile" role="list">' +
          columnItems.join('') +
          '</ul>'
        );
      }).join('') +
      '</div>'
    );
  }

  function foldersFor(id) {
    return (CONTACT_FOLDERS[id] || DEFAULT_FOLDERS).slice();
  }

  function assignedFor(id) {
    return (CONTACT_ASSIGNED[id] || DEFAULT_ASSIGNED).slice();
  }

  function renderAssignedStatusBadge(label, status) {
    var colorKey = ASSIGNED_STATUS_COLORS[status] || 'purple';
    return (
      '<span class="tma-status-badge tma-status-badge--dot tma-status-badge--' + esc(colorKey) + '">' +
      '<span class="tma-status-badge__dot" aria-hidden="true"></span>' +
      '<span class="tma-status-badge__label">' + esc(label) + '</span></span>'
    );
  }

  function socialDisplayValue(url) {
    return String(url || '')
      .replace(/^https?:\/\/(www\.)?/i, '')
      .replace(/^linkedin\.com\/in\//i, 'linkedin.com/in/')
      .replace(/^twitter\.com\//i, 'twitter.com/')
      .replace(/^instagram\.com\//i, 'instagram.com/')
      .replace(/^threads\.net\//i, 'threads.net/');
  }

  function buildProfileListItems(c) {
    var listItems = [];
    if (c.work.jobTitle) listItems.push(renderListItem({ icon: ICONS.Briefcase, label: 'Job title', value: c.work.jobTitle }));
    if (c.work.department) listItems.push(renderListItem({ icon: ICONS.UserCircle, label: 'Department', value: c.work.department }));
    if (c.work.company) listItems.push(renderListItem({ icon: ICONS.Buildings, label: 'Company', value: c.work.company }));

    c.phones.forEach(function (phone) {
      if (!phone.value) return;
      listItems.push(renderListItem({
        icon: ICONS.Phone,
        label: phoneTypeLabel(phone.type),
        value: phone.value,
        href: telHref(phone.value),
        linkLabel: 'Call ' + c.name,
      }));
    });

    c.emails.forEach(function (email) {
      if (!email.value) return;
      listItems.push(renderListItem({
        icon: ICONS.EnvelopeSimple,
        label: emailTypeLabel(email.type),
        value: email.value,
        href: 'mailto:' + email.value,
        linkLabel: 'Email ' + c.name,
      }));
    });

    c.addresses.forEach(function (addr) {
      var text = formatAddress(addr);
      if (!text) return;
      listItems.push(renderListItem({
        icon: ICONS.MapPin,
        label: addressTypeLabel(addr.type),
        value: text,
        href: mapsHref(addr),
        linkLabel: 'Open address in maps',
      }));
    });

    if (c.website) {
      listItems.push(renderListItem({
        icon: ICONS.Globe,
        label: 'Website',
        value: c.website,
        href: c.website.indexOf('://') === -1 ? 'https://' + c.website : c.website,
        linkLabel: 'Open website',
      }));
    }

    c.importantDates.forEach(function (entry) {
      if (!entry.date) return;
      listItems.push(renderListItem({
        icon: ICONS.CalendarBlank,
        label: dateEntryLabel(entry),
        value: formatDateDisplay(entry.date),
      }));
    });

    if (c.linkedIn) {
      listItems.push(renderListItem({
        icon: ICONS.LinkedinLogo,
        label: 'LinkedIn',
        value: c.linkedIn.replace(/^https?:\/\/(www\.)?linkedin\.com\//i, ''),
        href: c.linkedIn.indexOf('://') === -1 ? 'https://' + c.linkedIn : c.linkedIn,
        linkLabel: 'Open LinkedIn profile',
      }));
    }

    (c.socials || []).forEach(function (social) {
      if (!social || !social.value) return;
      if (social.type === 'linkedin' && c.linkedIn) return;
      var label = SOCIAL_LABELS[social.type] || social.label || 'Social';
      var icon = SOCIAL_ICONS[social.type] || ICONS.ShareNetwork;
      var href = social.value.indexOf('://') === -1 ? 'https://' + social.value : social.value;
      listItems.push(renderListItem({
        icon: icon,
        label: label,
        value: socialDisplayValue(href),
        href: href,
        linkLabel: 'Open ' + label + ' profile',
      }));
    });

    if (c.notes) listItems.push(renderListItem({ icon: ICONS.ChatTeardropDots, label: 'Notes', value: c.notes }));

    return listItems;
  }

  function renderProfileTabs(activeTab) {
    return PROFILE_TABS.map(function (tab) {
      var active = tab.id === activeTab;
      return (
        '<button type="button" class="tma-tab' + (active ? ' is-active' : '') + '" role="tab"' +
        ' aria-selected="' + (active ? 'true' : 'false') + '" data-clients-tab="' + esc(tab.id) + '">' +
        '<span class="tma-tab__label">' + esc(tab.label) + '</span>' +
        '<span class="tma-tab__indicator" aria-hidden="true"></span>' +
        '</button>'
      );
    }).join('');
  }

  function renderContactInfoPanel(c, listItems, hidden) {
    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="info" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      renderProfileListColumns(listItems) +
      '<div class="tma-dash__clients-profile-stats">' +
      renderStat('Projects', c.projects) +
      renderStat('Working group', c.workingGroup) +
      renderStat('Likes', c.likes) +
      '</div></div>'
    );
  }

  function renderFolderRow(folder) {
    var countLabel = folder.count === 1 ? '1 file' : folder.count + ' files';
    return (
      '<button type="button" class="tma-dash__clients-folder" data-clients-folder="' + esc(folder.id) + '">' +
      '<span class="tma-dash__clients-folder-icon" aria-hidden="true">' +
      '<img src="' + ICONS.FolderFilled + '" alt="">' +
      '</span>' +
      '<span class="tma-dash__clients-folder-main">' +
      '<span class="tma-dash__clients-folder-name">' + esc(folder.name) + '</span>' +
      '<span class="tma-dash__clients-folder-meta">' + esc(countLabel) + ' · Updated ' + esc(folder.updated) + '</span>' +
      '</span>' +
      '<span class="tma-dash__clients-folder-count" aria-hidden="true">' + esc(String(folder.count)) + '</span>' +
      '</button>'
    );
  }

  function renderFoldersPanel(contactId, hidden) {
    var folders = foldersFor(contactId);
    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="folders" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      '<div class="tma-dash__clients-folders-head">' +
      '<span class="tma-dash__clients-folders-title">' + folders.length + ' folder' + (folders.length === 1 ? '' : 's') + '</span>' +
      '<button type="button" class="tma-dash__clients-folders-add" data-clients-folder-add>' +
      '<img src="' + ICONS.Plus + '" alt=""><span>Add folder</span></button>' +
      '</div>' +
      '<div class="tma-dash__clients-folders">' +
      folders.map(renderFolderRow).join('') +
      '</div></div>'
    );
  }

  function renderAssignedRow(item) {
    return (
      '<button type="button" class="tma-dash__clients-assigned" data-clients-assigned="' + esc(item.id) + '">' +
      '<span class="tma-dash__clients-assigned-icon" aria-hidden="true">' +
      '<img src="' + ICONS.Briefcase + '" alt="">' +
      '</span>' +
      '<span class="tma-dash__clients-assigned-main">' +
      '<span class="tma-dash__clients-assigned-title">' + esc(item.title) + '</span>' +
      '<span class="tma-dash__clients-assigned-meta">' + esc(item.project) + ' · ' + esc(item.time) + ' · Due ' + esc(item.due) + '</span>' +
      '</span>' +
      renderAssignedStatusBadge(item.statusLabel, item.status) +
      '</button>'
    );
  }

  function renderAssignedPanel(contactId, hidden) {
    var items = assignedFor(contactId);
    return (
      '<div class="tma-dash__clients-profile-panel" data-clients-panel="assigned" role="tabpanel"' +
      (hidden ? ' hidden' : '') + '>' +
      '<div class="tma-dash__clients-assigned-head">' +
      '<span class="tma-dash__clients-assigned-count">' + items.length + ' assigned item' + (items.length === 1 ? '' : 's') + '</span>' +
      '</div>' +
      (items.length
        ? '<div class="tma-dash__clients-assigned-list">' + items.map(renderAssignedRow).join('') + '</div>'
        : '<div class="tma-dash__clients-assigned-empty">No assigned work yet.</div>') +
      '</div>'
    );
  }

  function renderProfile(state) {
    var c = contactFor(state.selectedId);
    var subtitle = [c.nickname ? '"' + c.nickname + '"' : '', c.work.jobTitle, c.work.company].filter(Boolean).join(' · ');
    var activeTab = state.profileTab || 'info';
    var listItems = buildProfileListItems(c);

    return (
      '<div class="tma-dash__clients-detail">' +
      '<div class="tma-dash__clients-profile">' +
      '<div class="tma-dash__clients-profile-toolbar">' +
      '<div class="tma-dash__clients-profile-head">' + renderAvatar(c, 40) +
      '<div class="tma-dash__clients-profile-ident">' +
      '<span class="tma-dash__clients-profile-name">' + esc(c.name) + '</span>' +
      (subtitle ? '<span class="tma-dash__clients-profile-subtitle">' + esc(subtitle) + '</span>' : '') +
      '</div></div>' +
      '<div class="tma-dash__clients-profile-actions">' +
      '<button type="button" class="tma-dash__clients-icon-btn" data-clients-share aria-label="Share profile">' +
      '<img src="' + ICONS.ShareNetwork + '" alt=""></button>' +
      '<button type="button" class="tma-dash__clients-edit-btn" data-clients-edit>' +
      '<img src="' + ICONS.PencilSimple + '" alt=""><span>Edit</span></button>' +
      '<button type="button" class="tma-dash__clients-message-btn" data-clients-message>' +
      '<img src="' + ICONS.ChatTeardropDots + '" alt=""><span>Message</span></button>' +
      '</div></div>' +
      '<div class="tma-tab-group tma-tab-group--underline tma-dash__clients-profile-tablist" role="tablist" aria-label="Client sections">' +
      renderProfileTabs(activeTab) +
      '</div>' +
      renderContactInfoPanel(c, listItems, activeTab !== 'info') +
      renderFoldersPanel(c.id, activeTab !== 'folders') +
      renderAssignedPanel(c.id, activeTab !== 'assigned') +
      '</div></div>'
    );
  }

  function readFormDraft(root) {
    var draft = emptyDraft();
    var get = function (field) {
      var el = root.querySelector('[data-clients-field="' + field + '"]');
      return el ? el.value.trim() : '';
    };

    draft.firstName = get('firstName');
    draft.middleName = get('middleName');
    draft.lastName = get('lastName');
    draft.nickname = get('nickname');
    draft.website = get('website');
    draft.linkedIn = get('linkedIn');
    draft.notes = get('notes');

    var photoBtn = root.querySelector('[data-clients-photo-btn]');
    var photoPreview = root.querySelector('[data-clients-photo-preview]');
    draft.photo = photoBtn && photoBtn.dataset.hasImage && photoPreview && photoPreview.src ? photoPreview.src : '';

    draft.work = {
      jobTitle: get('jobTitle'),
      department: get('department'),
      company: get('company'),
    };

    draft.phones = [];
    root.querySelectorAll('[data-clients-phone-row]').forEach(function (row) {
      var i = row.getAttribute('data-clients-phone-row');
      var typeEl = root.querySelector('[data-clients-phone-type="' + i + '"]');
      var valueEl = root.querySelector('[data-clients-phone-value="' + i + '"]');
      draft.phones.push({
        type: typeEl ? typeEl.value : 'mobile',
        value: valueEl ? valueEl.value.trim() : '',
      });
    });

    draft.emails = [];
    root.querySelectorAll('[data-clients-email-row]').forEach(function (row) {
      var i = row.getAttribute('data-clients-email-row');
      var typeEl = root.querySelector('[data-clients-email-type="' + i + '"]');
      var valueEl = root.querySelector('[data-clients-email-value="' + i + '"]');
      draft.emails.push({
        type: typeEl ? typeEl.value : 'work',
        value: valueEl ? valueEl.value.trim() : '',
      });
    });

    draft.addresses = [];
    root.querySelectorAll('[data-clients-address-row]').forEach(function (row) {
      var i = row.getAttribute('data-clients-address-row');
      var typeEl = root.querySelector('[data-clients-address-type="' + i + '"]');
      draft.addresses.push({
        type: typeEl ? typeEl.value : 'work',
        street: get('address-street-' + i),
        city: get('address-city-' + i),
        state: get('address-state-' + i),
        zip: get('address-zip-' + i),
        country: get('address-country-' + i),
      });
    });

    draft.importantDates = [];
    root.querySelectorAll('[data-clients-date-row]').forEach(function (row) {
      var i = row.getAttribute('data-clients-date-row');
      var typeEl = root.querySelector('[data-clients-date-type="' + i + '"]');
      var labelEl = root.querySelector('[data-clients-date-label="' + i + '"]');
      var valueEl = root.querySelector('[data-clients-date-value="' + i + '"]');
      draft.importantDates.push({
        type: typeEl ? typeEl.value : 'birthday',
        label: labelEl ? labelEl.value.trim() : '',
        date: valueEl ? valueEl.value : '',
      });
    });

    if (!draft.phones.length) draft.phones = [emptyPhone()];
    if (!draft.emails.length) draft.emails = [emptyEmail()];
    if (!draft.addresses.length) draft.addresses = [emptyAddress()];
    if (!draft.importantDates.length) draft.importantDates = [emptyDate('birthday')];

    return draft;
  }

  function syncDraftFromForm(root, state) {
    if (root.querySelector('[data-clients-form]')) {
      state.draft = readFormDraft(root);
    }
  }

  function slugId(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'contact';
  }

  function uniqueId(base) {
    var id = base;
    var n = 2;
    while (directoryItemFor(id)) {
      id = base + '-' + n;
      n += 1;
    }
    return id;
  }

  function insertContact(item) {
    var letter = item.name.charAt(0).toUpperCase();
    if (!/^[A-Z]$/.test(letter)) letter = '#';
    var group = null;
    for (var i = 0; i < DIRECTORY.length; i++) {
      if (DIRECTORY[i].letter === letter) {
        group = DIRECTORY[i];
        break;
      }
    }
    if (!group) {
      group = { letter: letter, items: [] };
      DIRECTORY.push(group);
      DIRECTORY.sort(function (a, b) { return a.letter.localeCompare(b.letter); });
    }
    group.items.push(item);
    group.items.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function saveContactRecord(id, draft, isNew) {
    var name = displayName(draft) || 'New Client';
    var item = directoryItemFor(id);
    var existing = PROFILES[id] || {};

    if (isNew) {
      insertContact({
        id: id,
        name: name,
        initial: name.charAt(0).toUpperCase(),
        initialColor: 'blue',
      });
    } else if (item) {
      item.name = name;
    }

    PROFILES[id] = Object.assign({}, cloneDraft(draft), {
      projects: existing.projects || '0',
      workingGroup: existing.workingGroup || '0',
      likes: existing.likes || '0',
    });

    var birthdayEntry = draft.importantDates.filter(function (entry) {
      return entry.type === 'birthday' && entry.date;
    })[0];
    PROFILES[id].birthday = birthdayEntry ? birthdayEntry.date : '';
  }

  function resetClientsScroll(root) {
    var main = document.querySelector('.tma-dash__main');
    if (main) main.scrollTop = 0;
    if (!root) return;
    var page = root.querySelector('.tma-dash__clients-page');
    if (page) page.scrollTop = 0;
    var detail = root.querySelector('.tma-dash__clients-detail');
    if (detail) detail.scrollTop = 0;
  }

  function wireDirectoryRows(root, state, navigate) {
    root.querySelectorAll('[data-clients-row]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-clients-check]') || e.target.closest('[data-clients-search-wrap]')) return;
        e.preventDefault();
        var id = row.getAttribute('data-clients-row');
        if (!id) return;
        state.profileTab = 'info';
        navigate('detail', id);
      });
    });
  }

  function syncSearchWrap(root, state) {
    root.querySelectorAll('[data-clients-search-wrap]').forEach(function (wrap) {
      var isToolbar = wrap.classList.contains('tma-dash__toolbar-search');
      var focused = !!(state.searchFocused || state.search);
      var hasValue = !!state.search;
      var loading = !!state.searchLoading;
      if (isToolbar) {
        wrap.classList.toggle('tma-dash__toolbar-search--focused', focused);
        wrap.classList.toggle('tma-dash__toolbar-search--has-value', hasValue);
        wrap.classList.toggle('tma-dash__toolbar-search--loading', loading);
        return;
      }
      wrap.classList.toggle('tma-dash__clients-search--focused', focused);
      wrap.classList.toggle('tma-dash__clients-search--has-value', hasValue);
      wrap.classList.toggle('tma-dash__clients-search--loading', loading);
    });
  }

  function wireTablePagination(root, state, render) {
    var pagination = root.querySelector('[data-clients-pagination]');
    if (!pagination) return;

    pagination.querySelectorAll('[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var page = parseInt(btn.getAttribute('data-page'), 10);
        if (!page || page === state.page) return;
        state.page = page;
        render({ forceFull: true });
      });
    });

    var prev = pagination.querySelector('[data-direction="prev"]');
    if (prev) {
      prev.addEventListener('click', function () {
        if (state.page <= 1) return;
        state.page -= 1;
        render({ forceFull: true });
      });
    }

    var next = pagination.querySelector('[data-direction="next"]');
    if (next) {
      next.addEventListener('click', function () {
        var totalPages = Math.max(1, Math.ceil(filteredDirectoryItems(state).length / (state.pageSize || 10)));
        if (state.page >= totalPages) return;
        state.page += 1;
        render({ forceFull: true });
      });
    }

    var pageSizeBtn = pagination.querySelector('[data-clients-page-size]');
    if (pageSizeBtn) {
      pageSizeBtn.addEventListener('click', function () {
        var idx = CLIENTS_PAGE_SIZES.indexOf(state.pageSize || 10);
        var nextSize = CLIENTS_PAGE_SIZES[(idx + 1) % CLIENTS_PAGE_SIZES.length];
        state.pageSize = nextSize;
        state.page = 1;
        render({ forceFull: true });
      });
    }
  }

  function deleteSelectedClients(state, render) {
    var keys = Object.keys(state.selected || {});
    if (!keys.length) return;
    state.removedIds = state.removedIds || {};
    keys.forEach(function (key) { state.removedIds[key] = true; });
    state.selected = {};
    state.page = 1;
    render({ forceFull: true });
  }

  function duplicateSelectedClients(state, render) {
    var keys = Object.keys(state.selected || {});
    if (!keys.length) return;
    var nextSelected = {};
    keys.forEach(function (key) {
      var item = directoryItemFor(key);
      if (!item) return;
      var newId = key + '-copy-' + String(Date.now() + Math.floor(Math.random() * 1000));
      var newItem = Object.assign({}, item, { id: newId, name: item.name + ' (copy)' });
      insertContact(newItem);
      if (PROFILES[key]) {
        PROFILES[newId] = JSON.parse(JSON.stringify(PROFILES[key]));
      }
      nextSelected[newId] = true;
    });
    state.selected = nextSelected;
    render({ forceFull: true });
  }

  function wireTableBulkActions(root, state, render) {
    root.querySelectorAll('[data-clients-bulk-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-clients-bulk-action');
        if (action === 'delete') deleteSelectedClients(state, render);
        else if (action === 'duplicate') duplicateSelectedClients(state, render);
      });
    });
  }

  function wireTableSelection(root, state) {
    var items = filteredDirectoryItems(state);
    var selectAll = root.querySelector('[data-clients-selectall]');
    var rowChecks = Array.prototype.slice.call(root.querySelectorAll('[data-clients-check]'));

    function syncRow(cb, rowIndex) {
      var rowEl = cb.closest('[data-row-index]');
      var item = items[rowIndex];
      if (!item) return;
      var key = clientRowKey(item);
      if (cb.checked) state.selected[key] = true;
      else delete state.selected[key];
      if (rowEl) rowEl.classList.toggle('tma-dash__ctr--selected', cb.checked);
      updateTableToolbarSelection(root, state);
    }

    function syncSelectAll() {
      if (!selectAll) return;
      var checked = rowChecks.filter(function (c) { return c.checked; }).length;
      selectAll.checked = checked === rowChecks.length && rowChecks.length > 0;
      selectAll.indeterminate = checked > 0 && checked < rowChecks.length;
    }

    rowChecks.forEach(function (cb) {
      var rowEl = cb.closest('[data-row-index]');
      var rowIndex = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : 0;
      cb.addEventListener('change', function () {
        syncRow(cb, rowIndex);
        syncSelectAll();
      });
    });

    if (selectAll) {
      selectAll.addEventListener('change', function () {
        rowChecks.forEach(function (cb) {
          var rowEl = cb.closest('[data-row-index]');
          var rowIndex = rowEl ? parseInt(rowEl.getAttribute('data-row-index'), 10) : 0;
          cb.checked = selectAll.checked;
          syncRow(cb, rowIndex);
        });
        selectAll.indeterminate = false;
      });
      syncSelectAll();
    }
  }

  function refreshDirectoryFromSearch(root, state) {
    state.page = 1;
    if (root.querySelector('[data-clients-body]') && state.viewMode === 'list') {
      if (root._clientsController && root._clientsController.render) {
        root._clientsController.render({ forceFull: true });
      }
      return;
    }

    syncDirectoryList(root, state);
    root.querySelectorAll('[data-clients-row]').forEach(function (btn) {
      var id = btn.getAttribute('data-clients-row');
      btn.classList.toggle('tma-dash__clients-row--active', id === state.selectedId);
    });
    syncSearchWrap(root, state);
  }

  function ensureClientsSearchWiring(root, state) {
    if (root._clientsSearchWiring) return;
    root._clientsSearchWiring = true;
    var searchTimer = null;

    root.addEventListener('focusin', function (e) {
      if (!e.target.matches('[data-clients-search]')) return;
      state.searchFocused = true;
      syncSearchWrap(root, state);
    });

    root.addEventListener('focusout', function (e) {
      if (!e.target.matches('[data-clients-search]')) return;
      state.searchFocused = false;
      syncSearchWrap(root, state);
    });

    root.addEventListener('input', function (e) {
      if (!e.target.matches('[data-clients-search]')) return;
      state.search = e.target.value;
      state.searchFocused = true;
      state.searchLoading = true;
      syncSearchWrap(root, state);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.searchLoading = false;
        refreshDirectoryFromSearch(root, state);
      }, 180);
    });

    root.addEventListener('click', function (e) {
      var wrap = e.target.closest('[data-clients-search-wrap]');
      if (!wrap || !root.contains(wrap)) return;

      if (e.target.closest('[data-clients-search-clear]')) {
        e.preventDefault();
        clearTimeout(searchTimer);
        state.search = '';
        state.searchLoading = false;
        state.searchFocused = true;
        var searchInput = wrap.querySelector('[data-clients-search]');
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        refreshDirectoryFromSearch(root, state);
        return;
      }

      if (e.target.closest('[data-clients-search-shortcut]')) {
        e.preventDefault();
        var shortcutInput = wrap.querySelector('[data-clients-search]');
        if (shortcutInput) shortcutInput.focus();
        state.searchFocused = true;
        syncSearchWrap(root, state);
        return;
      }

      if (!e.target.matches('[data-clients-search]')) {
        var clickInput = wrap.querySelector('[data-clients-search]');
        if (clickInput) clickInput.focus();
        state.searchFocused = true;
        syncSearchWrap(root, state);
      }
    });
  }

  function syncDirectoryList(root, state) {
    var body = root.querySelector('.tma-dash__clients-directory-body');
    if (!body) return false;
    body.innerHTML = renderDirectoryListBody(state);
    return true;
  }

  function wireSearchEvents(root, state) {
    ensureClientsSearchWiring(root, state);
  }

  var clientsHeadActionsNavigate = null;
  var clientsHeadActionsWired = false;

  var CLIENTS_ADMIN_PAGES = {
    'clienthub-access': { title: 'Client hub access' },
    'service-teams': { title: 'Service teams' },
    'custom-fields': { title: 'Custom fields' },
  };

  function navigateToClientsAdminPage(adminPage) {
    var meta = CLIENTS_ADMIN_PAGES[adminPage];
    if (!meta || !window.TMADashboard || !window.TMADashboard.navigate) return;
    window.TMADashboard.navigate({
      navId: 'account-settings',
      view: 'admin',
      title: meta.title,
      crumb: 'Account settings / Client hub management / ' + meta.title,
      adminPage: adminPage,
    });
  }

  function ensureClientsHeadActionsWiring() {
    if (clientsHeadActionsWired) return;
    clientsHeadActionsWired = true;
    if (window.TMAHeadDropdown) window.TMAHeadDropdown.mount();

    document.addEventListener('head-dropdown:select', function (event) {
      var wrap = event.detail && event.detail.wrap;
      if (!wrap || !wrap.closest('[data-clients-page-actions]')) return;
      var action = event.detail.action || '';

      if (action.indexOf('admin:') === 0) {
        navigateToClientsAdminPage(action.slice(6));
        return;
      }
      if (action === 'create-new' && clientsHeadActionsNavigate) {
        clientsHeadActionsNavigate('add');
        return;
      }
      if (action === 'create-import') {
        var slot = wrap.closest('[data-clients-page-actions]');
        var importInput = slot && slot.querySelector('[data-clients-import-input]');
        if (importInput) importInput.click();
      }
    });

    document.addEventListener('change', function (event) {
      var input = event.target.closest('[data-clients-import-input]');
      if (input) input.value = '';
    });
  }


  function wireEvents(root, state, scope, navigate, render) {
    if (scope === 'list' || scope === 'split') {
      wireDirectoryRows(root, state, navigate);
      wireSearchEvents(root, state);

      root.querySelectorAll('[data-clients-layout]').forEach(function (btn) {
        btn.remove();
      });

      if (scope === 'list' && state.viewMode === 'list') {
        wireTablePagination(root, state, render);
        wireTableSelection(root, state);
        wireTableBulkActions(root, state, render);
        return;
      }
    }

    var backBtn = root.querySelector('[data-clients-back]');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (state.screen === 'edit') navigate('detail', state.selectedId);
        else navigate('list');
      });
    }

    var editBtn = root.querySelector('[data-clients-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        navigate('edit', state.selectedId);
      });
    }

    var cancelBtn = root.querySelector('[data-clients-cancel]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        if (state.screen === 'add' || state.adding) {
          if (usesPagedClientsFlow(state)) navigate('list');
          else navigate('detail', state.selectedId);
        } else {
          navigate('detail', state.selectedId);
        }
      });
    }

    var saveBtn = root.querySelector('[data-clients-save]');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var draft = readFormDraft(root);
        if (state.adding) {
          var name = displayName(draft) || 'New Client';
          var id = uniqueId(slugId(name));
          saveContactRecord(id, draft, true);
          navigate('detail', id, { forceFull: !usesPagedClientsFlow(state) });
        } else {
          saveContactRecord(state.selectedId, draft, false);
          navigate('detail', state.selectedId);
        }
      });
    }

    root.querySelectorAll('[data-clients-add-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        syncDraftFromForm(root, state);
        var group = btn.getAttribute('data-clients-add-group');
        if (group === 'phones') state.draft.phones.push(emptyPhone('mobile'));
        if (group === 'emails') state.draft.emails.push(emptyEmail());
        if (group === 'addresses') state.draft.addresses.push(emptyAddress());
        if (group === 'importantDates') state.draft.importantDates.push(emptyDate('custom'));
        if (usesPagedClientsFlow(state)) render();
        else render({ detailOnly: true });
      });
    });

    root.querySelectorAll('[data-clients-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        syncDraftFromForm(root, state);
        var group = btn.getAttribute('data-clients-remove');
        var index = parseInt(btn.getAttribute('data-clients-index'), 10);
        if (group === 'phones' && state.draft.phones.length > 1) state.draft.phones.splice(index, 1);
        if (group === 'emails' && state.draft.emails.length > 1) state.draft.emails.splice(index, 1);
        if (group === 'addresses' && state.draft.addresses.length > 1) state.draft.addresses.splice(index, 1);
        if (group === 'importantDates' && state.draft.importantDates.length > 1) state.draft.importantDates.splice(index, 1);
        if (usesPagedClientsFlow(state)) render();
        else render({ detailOnly: true });
      });
    });

    var photoBtn = root.querySelector('[data-clients-photo-btn]');
    var photoInput = root.querySelector('[data-clients-photo-input]');
    var photoPreview = root.querySelector('[data-clients-photo-preview]');
    var photoRemove = root.querySelector('[data-clients-photo-remove]');
    var formHead = root.querySelector('.tma-dash__clients-profile--form .tma-dash__clients-profile-head');

    if (photoBtn && photoInput) {
      photoBtn.addEventListener('click', function () {
        photoInput.click();
      });

      photoInput.addEventListener('change', function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file || !photoPreview) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          photoPreview.src = ev.target.result;
          photoPreview.alt = 'Client photo';
          photoBtn.dataset.hasImage = 'true';
          syncDraftFromForm(root, state);
          if (formHead) {
            formHead.innerHTML =
              renderFormHeadAvatar(state.draft, null, !!state.adding) +
              '<span class="tma-dash__clients-profile-name">' + esc(state.adding ? 'New client' : 'Edit client') + '</span>';
          }
        };
        reader.readAsDataURL(file);
      });
    }

    if (photoRemove) {
      photoRemove.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (photoBtn) delete photoBtn.dataset.hasImage;
        if (photoPreview) {
          photoPreview.removeAttribute('src');
          photoPreview.alt = '';
        }
        if (photoInput) photoInput.value = '';
        syncDraftFromForm(root, state);
        if (formHead) {
          var contact = state.adding ? null : contactFor(state.selectedId);
          formHead.innerHTML =
            renderFormHeadAvatar(state.draft, contact, !!state.adding) +
            '<span class="tma-dash__clients-profile-name">' + esc(state.adding ? 'New client' : 'Edit client') + '</span>';
        }
      });
    }

    root.querySelectorAll('[data-clients-date-type]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var i = sel.getAttribute('data-clients-date-type');
        var labelEl = root.querySelector('[data-clients-date-label="' + i + '"]');
        if (!labelEl) return;
        var isCustom = sel.value === 'custom';
        labelEl.disabled = !isCustom;
        labelEl.classList.toggle('tma-dash__clients-date-label--hidden', !isCustom);
      });
    });

    var messageBtn = root.querySelector('[data-clients-message]');
    if (messageBtn) {
      messageBtn.addEventListener('click', function () {
        if (window.TMADashboard && window.TMADashboard.navigate) {
          window.TMADashboard.navigate({
            navId: 'so-messages',
            view: 'messages',
            title: 'Messages',
            crumb: 'Messages',
          });
        }
      });
    }

    var shareBtn = root.querySelector('[data-clients-share]');
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        var c = contactFor(state.selectedId);
        var lines = [c.name];
        if (c.nickname) lines.push('Nickname: ' + c.nickname);
        if (c.work.jobTitle) lines.push('Title: ' + c.work.jobTitle);
        c.phones.forEach(function (p) { if (p.value) lines.push(phoneTypeLabel(p.type) + ': ' + p.value); });
        c.emails.forEach(function (e) { if (e.value) lines.push(emailTypeLabel(e.type) + ': ' + e.value); });
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lines.join('\n'));
      });
    }

    root.querySelectorAll('[data-clients-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.profileTab = btn.getAttribute('data-clients-tab');
        if (usesPagedClientsFlow(state)) render();
        else render({ detailOnly: true });
      });
    });
  }

  var clientsMountRoot = null;

  function syncClientsShell(screen, viewMode) {
    var dash = document.querySelector('.tma-dash');
    if (!dash) return;
    var mobile = isClientsMobile();
    var listFull = !mobile && viewMode === 'list';
    dash.classList.toggle('tma-dash--clients-mobile', mobile);
    dash.classList.toggle('tma-dash--clients-detail', (mobile || listFull) && screen !== 'list');
    dash.classList.toggle('tma-dash--clients-table', listFull && screen === 'list');
  }

  function mount(root) {
    clientsMountRoot = root;
    if (root._clientsController) {
      root._clientsController.syncRoute(parseClientsPath(window.location.pathname));
      return;
    }

    var state = {
      screen: 'list',
      selectedId: 'byewind',
      adding: false,
      editing: false,
      draft: null,
      profileTab: 'info',
      listScrollTop: 0,
      search: '',
      searchFocused: false,
      searchLoading: false,
      viewMode: loadViewMode(),
      page: 1,
      pageSize: 10,
      selected: {},
      removedIds: {},
    };

    function pageMetaFor(screen, contactId) {
      if (usesPagedClientsFlow(state) && screen !== 'list') {
        return { title: 'Clients', crumb: 'Clients' };
      }
      if (screen === 'add') {
        return { title: 'New client', crumb: 'Clients / New' };
      }
      if ((screen === 'detail' || screen === 'edit') && contactId) {
        var contact = contactFor(contactId);
        if (screen === 'edit') {
          return { title: contact.name, crumb: 'Clients / ' + contact.name };
        }
        return { title: contact.name, crumb: 'Clients / ' + contact.name };
      }
      return { title: 'Clients', crumb: 'Clients' };
    }

    function applyScreen(screen, contactId) {
      var previousId = state.selectedId;
      state.screen = screen;
      state.adding = screen === 'add';
      state.editing = screen === 'edit';
      if (contactId) state.selectedId = contactId;
      if (contactId && contactId !== previousId) state.profileTab = 'info';

      if (screen === 'add') {
        state.draft = emptyDraft();
        state.profileTab = 'info';
        return;
      }

      if (screen === 'edit' && contactId) {
        state.draft = contactToDraft(contactFor(contactId));
        return;
      }

      state.draft = null;
      if (screen === 'detail') state.profileTab = state.profileTab || 'info';
    }

    function renderDetailPanel() {
      var page = root.querySelector('.tma-dash__clients-page');
      if (!page) return false;
      var detail = page.querySelector('.tma-dash__clients-detail');
      var html = state.adding || state.editing
        ? renderContactFormPanel(state)
        : renderProfile(state);
      if (detail) {
        detail.outerHTML = html;
      } else {
        page.insertAdjacentHTML('beforeend', html);
      }
      return true;
    }

    function syncDirectorySelection() {
      root.querySelectorAll('[data-clients-row]').forEach(function (btn) {
        var id = btn.getAttribute('data-clients-row');
        var isActive = id === state.selectedId;
        btn.classList.toggle('tma-dash__clients-row--active', isActive);
      });
    }

    function render(options) {
      options = options || {};
      syncClientsShell(state.screen, state.viewMode);
      syncClientsPageActions(state, navigate);
      root.className = state.viewMode === 'grid'
        ? 'tma-dash__clients tma-dash__clients--grid'
        : 'tma-dash__clients';

      if (usesPagedClientsFlow(state)) {
        if (state.screen === 'list') {
          root.innerHTML = state.viewMode === 'list'
            ? renderTableListPage(state)
            : renderListPage(state);
          wireEvents(root, state, 'list', navigate, render);
          if (window.TMATableViewToggle) window.TMATableViewToggle.sync('clients');
          requestAnimationFrame(function () {
            var dirBody = root.querySelector('.tma-dash__clients-directory-body');
            if (dirBody) dirBody.scrollTop = state.listScrollTop;
          });
          return;
        }

        root.innerHTML = renderDetailPage(state);
        wireEvents(root, state, 'detail', navigate, render);
        if (window.TMATableViewToggle) window.TMATableViewToggle.sync('clients');
        return;
      }

      if (!isClientsMobile()) {
        var hasSplit = root.querySelector('.tma-dash__clients-page .tma-dash__clients-directory');
        if (!options.forceFull && hasSplit && options.detailOnly && renderDetailPanel()) {
          syncDirectorySelection();
          wireEvents(root, state, 'split', navigate, render);
          return;
        }
        root.innerHTML = renderDesktopPage(state);
        wireEvents(root, state, 'split', navigate, render);
        if (window.TMATableViewToggle) window.TMATableViewToggle.sync('clients');
        requestAnimationFrame(function () {
          var dirBody = root.querySelector('.tma-dash__clients-directory-body');
          if (dirBody) dirBody.scrollTop = state.listScrollTop;
        });
        return;
      }

      if (state.screen === 'list') {
        root.innerHTML = renderListPage(state);
        wireEvents(root, state, 'list', navigate, render);
        requestAnimationFrame(function () {
          var dirBody = root.querySelector('.tma-dash__clients-directory-body');
          if (dirBody) dirBody.scrollTop = state.listScrollTop;
        });
        return;
      }

      root.innerHTML = renderDetailPage(state);
      wireEvents(root, state, 'detail', navigate, render);
    }

    function navigate(screen, contactId, navOpts) {
      navOpts = navOpts || {};
      contactId = contactId || state.selectedId;

      if (!usesPagedClientsFlow(state)) {
        var dirBody = root.querySelector('.tma-dash__clients-directory-body');
        if (dirBody) state.listScrollTop = dirBody.scrollTop;

        applyScreen(screen, contactId || state.selectedId);

        var meta = pageMetaFor(screen, contactId || state.selectedId);
        if (screen === 'detail' || screen === 'edit') {
          meta = pageMetaFor(screen, contactId || state.selectedId);
        } else if (screen === 'add') {
          meta = pageMetaFor('add');
        } else if (screen === 'list') {
          meta = pageMetaFor('detail', state.selectedId);
        }

        history.replaceState(
          {
            navId: 'clients',
            view: 'clients',
            title: meta.title,
            crumb: meta.crumb,
            clientsScreen: 'list',
            contactId: state.selectedId || null,
          },
          '',
          '/clients'
        );

        if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
          window.TMADashboard.updatePageMeta(meta);
        }

        var needsFullRender = !!navOpts.forceFull || (screen === 'add' && !root.querySelector('.tma-dash__clients-page'));
        render({
          detailOnly: !needsFullRender,
          forceFull: needsFullRender,
        });
        return;
      }

      if (state.screen === 'list') {
        var listDirBody = root.querySelector('.tma-dash__clients-directory-body');
        state.listScrollTop = listDirBody ? listDirBody.scrollTop : 0;
      }

      applyScreen(screen, contactId || state.selectedId);

      var mobileMeta = pageMetaFor(screen, contactId || state.selectedId);
      var historyState = {
        navId: 'clients',
        view: 'clients',
        title: mobileMeta.title,
        crumb: mobileMeta.crumb,
        clientsScreen: screen,
        contactId: contactId || null,
      };

      history.pushState(historyState, '', pathForClientsScreen(screen, contactId || state.selectedId));

      if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
        window.TMADashboard.updatePageMeta(mobileMeta);
      }

      render();

      if (screen !== 'list') {
        requestAnimationFrame(function () {
          resetClientsScroll(root);
        });
      }
    }

    function syncRoute(route) {
      route = route || parseClientsPath(window.location.pathname);
      if (!route) return;

      if (route.legacyRedirect && window.history.replaceState) {
        history.replaceState(
          {
            navId: 'clients',
            view: 'clients',
            title: route.screen === 'add' ? 'New client' : 'Clients',
            crumb: route.screen === 'add' ? 'Clients / New' : 'Clients',
            clientsScreen: route.screen || 'list',
            contactId: route.contactId || null,
          },
          '',
          pathForClientsScreen(route.screen || 'list', route.contactId)
        );
      }

      if (!isClientsMobile() && state.viewMode !== 'list') {
        if (route.contactId) state.selectedId = route.contactId;
        state.adding = route.screen === 'add';
        state.editing = route.screen === 'edit';
        state.draft = null;
        if (state.adding) {
          state.draft = emptyDraft();
          state.screen = 'add';
        } else if (state.editing && route.contactId) {
          state.draft = contactToDraft(contactFor(route.contactId));
          state.screen = 'edit';
        } else {
          state.screen = 'detail';
        }
        if (!state.selectedId) state.selectedId = 'byewind';

        syncClientsShell(state.screen, state.viewMode);

        var desktopMeta = state.adding
          ? pageMetaFor('add')
          : state.editing
            ? pageMetaFor('edit', state.selectedId)
            : pageMetaFor('detail', state.selectedId);

        if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
          window.TMADashboard.updatePageMeta(desktopMeta);
        }

        render();

        if (route.screen !== 'list' && window.history.replaceState) {
          history.replaceState(
            {
              navId: 'clients',
              view: 'clients',
              title: 'Clients',
              crumb: 'Clients',
              clientsScreen: 'list',
              contactId: state.selectedId,
            },
            '',
            '/clients'
          );
        }
        return;
      }

      applyScreen(route.screen || 'list', route.contactId);
      syncClientsShell(state.screen, state.viewMode);

      var meta = pageMetaFor(state.screen, state.selectedId);
      if (window.TMADashboard && window.TMADashboard.updatePageMeta) {
        window.TMADashboard.updatePageMeta(meta);
      }

      render();

      if (state.screen !== 'list') {
        requestAnimationFrame(function () {
          resetClientsScroll(root);
        });
      }
    }

    root._clientsController = { syncRoute: syncRoute, navigate: navigate, render: render };
    registerViewToggle({ state: state, render: render });

    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      var dash = document.querySelector('.tma-dash');
      if (!dash || !dash.classList.contains('tma-dash--clients')) return;
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      var searchInput = root.querySelector('[data-clients-search]');
      if (!searchInput) return;
      e.preventDefault();
      searchInput.focus();
      state.searchFocused = true;
      syncSearchWrap(root, state);
    });

    var lastMobile = isClientsMobile();
    window.addEventListener('resize', function () {
      var nextMobile = isClientsMobile();
      if (nextMobile === lastMobile) return;
      lastMobile = nextMobile;
      syncRoute(parseClientsPath(window.location.pathname));
    });

    syncRoute(parseClientsPath(window.location.pathname));
  }

  window.TMAClients = {
    mount: mount,
    contactFor: contactFor,
    hasContact: function (id) {
      return !!directoryItemFor(id);
    },
    syncRoute: function (route) {
      if (!clientsMountRoot || !clientsMountRoot._clientsController) return;
      var parsed = route || parseClientsPath(window.location.pathname);
      clientsMountRoot._clientsController.syncRoute(parsed);
    },
    routeFromPath: parseClientsPath,
  };
})();
