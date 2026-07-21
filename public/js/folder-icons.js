/*
 * TMA - Approved folder "front panel" icons + the stamped-icon renderer
 * Global: window.TMAFolderIcons
 * Mirrors App\Support\Files\FolderIcons::CATEGORIES - keep in sync.
 *
 * The folder body itself (FolderFilled/FolderEmpty, in colour) is a
 * pre-baked multi-colour image (see folder-colours.js) and can't be CSS-
 * masked. The optional content icon CAN be - it's a plain single-path
 * phosphor silhouette - so it's rendered as a small absolutely-positioned
 * masked <span> layered on top of the folder image, tinted to the folder's
 * own shade colour. That's what makes it read as "stamped into the front"
 * rather than a floating badge.
 */
(function (global) {
  'use strict';

  var PHOSPHOR = 'images/icons/phosphor/';

  var CATEGORIES = {
    Documents: ['File', 'FileText', 'Files', 'FilePdf', 'FileDoc', 'Clipboard', 'Notepad', 'BookOpen'],
    Clients: ['AddressBook', 'Briefcase', 'Buildings', 'Handshake', 'IdentificationCard', 'Storefront'],
    Users: ['User', 'UsersThree', 'UserCircle', 'UserGear', 'UserList', 'UserPlus'],
    Finance: ['CurrencyDollar', 'Wallet', 'ChartLine', 'Coins', 'Receipt', 'PiggyBank', 'Bank'],
    Contracts: ['Scroll', 'Gavel', 'Stamp', 'SealCheck'],
    Signatures: ['Signature', 'PenNib', 'Pen', 'PencilSimple'],
    Images: ['Image', 'ImageSquare', 'Images', 'Camera'],
    Videos: ['VideoCamera', 'FilmSlate', 'PlayCircle', 'Playlist'],
    Marketing: ['Megaphone', 'Rocket', 'TrendUp', 'Target', 'Sparkle'],
    Projects: ['Kanban', 'ListChecks', 'Flag', 'FlagCheckered', 'Path'],
    Reports: ['ChartBar', 'ChartPie', 'ChartDonut', 'Table', 'PresentationChart'],
    Legal: ['Scales', 'Gavel', 'Certificate', 'Shield', 'ShieldCheck'],
    Archive: ['Archive', 'ArchiveBox', 'ArchiveTray', 'Package'],
    Settings: ['Gear', 'GearSix', 'Sliders', 'Wrench', 'Toolbox'],
    Calendar: ['Calendar', 'CalendarBlank', 'CalendarCheck', 'Clock', 'Alarm'],
    Communication: ['ChatCircle', 'ChatDots', 'Envelope', 'Phone', 'Bell', 'At'],
  };

  var ALL = [];
  var SEEN = {};
  Object.keys(CATEGORIES).forEach(function (cat) {
    CATEGORIES[cat].forEach(function (name) {
      if (!SEEN[name]) { SEEN[name] = true; ALL.push(name); }
    });
  });

  function isValid(name) {
    return !name || SEEN.hasOwnProperty(name);
  }

  function iconPath(name) {
    return PHOSPHOR + name + '.svg';
  }

  // Builds the full markup for a folder icon: the base folder image, plus
  // an optional masked "stamp" overlay when a custom icon is set. With no
  // icon this returns exactly the plain <img> markup used before this
  // feature existed - zero extra DOM for the common case. `wrapClass` is
  // applied to whichever element ends up outermost (the bare <img>, or the
  // wrapper <span> once there's a stamp), so a caller's own sizing/display
  // classes (e.g. the sidebar's ".tma-dash__nav-icon") keep working either way.
  function html(base, colour, iconName, size, wrapClass) {
    var colours = global.TMAFolderColours;
    var src = colours ? colours.iconSrc(base, colour) : PHOSPHOR + base + '.svg';
    var extraClass = wrapClass ? ' ' + wrapClass : '';
    if (!isValid(iconName) || !iconName) {
      return '<img class="tma-folder-icon__base' + extraClass + '" src="' + src + '" alt="" width="' + size + '" height="' + size + '">';
    }

    var img = '<img class="tma-folder-icon__base" src="' + src + '" alt="" width="' + size + '" height="' + size + '">';
    var shade = colours ? colours.shade(colour) : '#ef9f2c';
    var stampSize = Math.max(8, Math.round(size * 0.42));
    var url = iconPath(iconName);
    var stamp = '<span class="tma-folder-icon__stamp" style="width:' + stampSize + 'px;height:' + stampSize + 'px;' +
      'background-color:' + shade + ';' +
      'mask-image:url(\'' + url + '\');-webkit-mask-image:url(\'' + url + '\')"></span>';
    return '<span class="tma-folder-icon' + extraClass + '" style="width:' + size + 'px;height:' + size + 'px">' + img + stamp + '</span>';
  }

  global.TMAFolderIcons = {
    CATEGORIES: CATEGORIES,
    ALL: ALL,
    isValid: isValid,
    iconPath: iconPath,
    html: html,
  };
})(typeof window !== 'undefined' ? window : this);
