/* TMA - Popover instances board (Figma 33303:7642) */
(function () {
  'use strict';

  const P = () => window.TMAPopover;

  function board(w, h, html) {
    return `<div class="tma-popover-instances-page__board-wrap"><div class="tma-popover-instances-page__board" style="width:${w}px;height:${h}px">${html}</div></div>`;
  }

  function place(left, top, html, nodeId) {
    return `<div class="tma-popover-instances-page__popover" style="left:${left}px;top:${top}px" data-node-id="${nodeId}">${html}</div>`;
  }

  function render7643() {
    return P().renderPopover({
      nodeId: '33303:7643',
      groups: [
        {
          search: { placeholder: 'Search' },
          items: [
            { label: 'Ask AI', icon: 'AI16', chevron: true },
            { label: 'Tags', icon: 'Tag16', meta: 'Multi-Select', chevron: true },
            { label: 'Edit Property', icon: 'SlidersHorizontal16', hover: true },
          ],
          border: true,
        },
        {
          items: [
            { label: 'Sort ascending', icon: 'ArrowsUp16', shortcut: '⌘C' },
            { label: 'Sort descending', icon: 'ArrowsDown16', shortcut: '⌘D' },
            { label: 'Filter', icon: 'FunnelSimple' },
          ],
          border: true,
        },
        {
          items: [
            { label: 'Hide in View', icon: 'EyeSlash16' },
            { label: 'Wrap Column', icon: 'TextColumns16', switch: true, switchOn: true, switchLarge: true, switchInteractive: true },
            { label: 'Delete Property', icon: 'Trash16', destructive: true },
          ],
          border: false,
        },
      ],
    });
  }

  function render7644() {
    return P().renderPopover({
      nodeId: '33303:7644',
      groups: [
        {
          search: { placeholder: 'Search', variant: 'focused', wrap: true },
          textRows: [{ label: 'No results', muted: true }],
          border: false,
        },
      ],
    });
  }

  function render7645() {
    return P().renderPopover({
      nodeId: '33303:7645',
      groups: [
        {
          search: { placeholder: 'Search', variant: 'focused', wrap: true },
          items: [
            { label: 'Ask AI', icon: 'AI16', chevron: true, hover: true },
            { label: 'Tags', icon: 'Tag16', meta: 'Multi-Select', chevron: true },
            { label: 'Filter', icon: 'FunnelSimple' },
          ],
          border: false,
        },
      ],
    });
  }

  function render7646() {
    return P().renderPopover({
      nodeId: '33303:7646',
      groups: [
        {
          valueInput: { placeholder: 'Type a value...' },
          items: [
            { label: 'Is', button: false, static: true },
            { label: 'Is not', button: false, static: true },
            { label: 'Contains', button: false, static: true, hover: true, check: true },
            { label: 'Does not contain', button: false, static: true },
            { label: 'Starts with', button: false, static: true },
            { label: 'Ends with', button: false, static: true },
          ],
          border: false,
        },
      ],
    });
  }

  function render7647() {
    return P().renderPopover({
      nodeId: '33303:7647',
      groups: [
        {
          search: { placeholder: 'Search' },
          items: [
            { label: 'Order ID', icon: 'ListNumbers16', chevron: true, static: true },
            { label: 'User', icon: 'User16', chevron: true, static: true },
            { label: 'Email', icon: 'EnvelopeSimple16', chevron: true, hover: true, static: true },
            { label: 'Address', icon: 'MapPin16', chevron: true, static: true },
            { label: 'Date', icon: 'CalendarBlank16', chevron: true, static: true },
            { label: 'Status', icon: 'CirclesThreePlus16', chevron: true, static: true },
          ],
          border: false,
        },
      ],
    });
  }

  function render7648() {
    return P().renderPopover({
      nodeId: '33303:7648',
      width: 360,
      groups: [
        {
          valueInput: { value: 'Text', wide: true },
          border: true,
        },
        {
          textRows: [{ label: 'All' }],
          header: 'Group 1',
          headerOpts: { chevron: 'down', surface: true, partial: true },
          items: [
            { label: 'Brie Larson', avatar: 'AvatarFemale03', check: true },
            { label: 'ByeWind', avatar: 'AvatarByewind', check: true },
            { label: 'Bruce Wayne', avatarInitial: 'B', avatarColor: '#7dbbff', check: true },
            { label: 'Drew Cano', avatar: 'AvatarMale01', check: true },
            { label: 'Emma Smith', avatar: 'Avatar3d04', check: true },
          ],
          border: true,
        },
        {
          header: 'Group 2',
          headerOpts: { chevron: 'down', surface: true, partial: 'minus' },
          items: [
            { label: 'Kate Morrison', avatar: 'AvatarFemale04', button: false, static: true },
            { label: 'Koray Okumus', avatar: 'AvatarMale04', button: false, static: true },
            { label: 'Melody Macy', avatar: 'AvatarFemale05', button: false, static: true },
            { label: 'Michael Brown', avatarInitial: 'M', avatarColor: '#71dd8c', button: false, static: true },
            { label: 'Natali Craig', avatar: 'AvatarFemale06', check: true },
            { label: 'Orlando Diggs', avatar: 'AvatarMale03', check: true },
          ],
          border: false,
        },
      ],
    });
  }

  function render7649() {
    return P().renderPopover({
      nodeId: '33303:7649',
      width: 320,
      groups: [
        {
          valueInput: { placeholder: 'Type a value...', padded: true, wrap: true },
          items: [
            { label: 'UTC -12:00 - Baker Island Time', button: false, static: true },
            { label: 'UTC -11:00 - Niue Time', button: false, static: true },
            { label: 'UTC -10:00 - Hawaii-Aleutian Standard Time', button: false, static: true, hover: true, check: true },
            { label: 'UTC -8:00 - Pacific Standard Time', button: false, static: true },
            { label: 'UTC -7:00 - Mountain Standard Time', button: false, static: true },
            { label: 'UTC -6:00 - Central Standard Time', button: false, static: true },
          ],
          border: false,
        },
      ],
    });
  }

  function render7650() {
    return P().renderPopover({
      nodeId: '33303:7650',
      width: 320,
      groups: [
        {
          valueInput: { placeholder: 'Type a value...', padded: true, wrap: true },
          items: [
            { label: 'English', button: false, static: true },
            { label: 'Español', button: false, static: true },
            { label: '中文(简体)', button: false, static: true, hover: true, check: true },
            { label: '中文(繁体)', button: false, static: true },
            { label: 'Français', button: false, static: true },
            { label: 'Deutsch', button: false, static: true },
          ],
          border: false,
        },
      ],
    });
  }

  function render7651() {
    return P().renderPopover({
      nodeId: '33303:7651',
      width: 280,
      groups: [
        {
          items: [
            {
              label: 'Strictly necessary',
              description: 'Essential for the site to function. Always On.',
              switch: true,
              switchOn: true,
              switchLarge: true,
              switchInteractive: true,
              switchLocked: true,
              static: true,
              button: false,
            },
            {
              label: 'Functional',
              description: 'Used to remember preference selections and provide enhanced features.',
              switch: true,
              switchOn: true,
              switchLarge: true,
              switchInteractive: true,
            },
            {
              label: 'Analytics',
              description: 'Used to measure usage and improve your experience.',
              switch: true,
              switchOn: true,
              switchLarge: true,
              switchInteractive: true,
            },
            {
              label: 'Marketing',
              description: 'Used for targeted advertising.',
              switch: true,
              switchOn: true,
              switchLarge: true,
              switchInteractive: true,
            },
          ],
          border: false,
        },
      ],
    });
  }

  function render7652() {
    return P().renderPopover({
      nodeId: '33303:7652',
      width: 280,
      groups: [
        {
          items: [
            { label: 'Authenticator app', icon: 'ShieldStar16' },
            { label: 'Phone number', icon: 'Phone16' },
            { label: 'Email', icon: 'EnvelopeSimple16' },
            { label: 'Backup codes', icon: 'CodeSimple16' },
            { label: 'Need help', icon: 'Question16' },
          ],
          border: false,
        },
      ],
    });
  }

  function renderInstancesBoard() {
    return board(1620, 880, [
      place(100, 100, render7647(), '33303:7647'),
      place(350, 100, render7643(), '33303:7643'),
      place(600, 100, render7648(), '33303:7648'),
      place(970, 100, render7649(), '33303:7649'),
      place(1300, 100, render7651(), '33303:7651'),
      place(100, 386, render7645(), '33303:7645'),
      place(350, 542, render7646(), '33303:7646'),
      place(970, 410, render7650(), '33303:7650'),
      place(1300, 414, render7652(), '33303:7652'),
      place(100, 580, render7644(), '33303:7644'),
    ].join(''));
  }

  function mountInstances(container) {
    if (!container || !P()) return;
    container.innerHTML = renderInstancesBoard();
    P().bindPopoverSwitches(container);
  }

  window.TMAPopoverInstances = {
    renderInstancesBoard,
    mountInstances,
    render7643,
    render7644,
    render7645,
    render7646,
    render7647,
    render7648,
    render7649,
    render7650,
    render7651,
    render7652,
  };
})();
