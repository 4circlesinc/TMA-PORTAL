/* TMA — Text instances showcase (Figma 32708:1064) */
(function () {
  'use strict';

  const BOARD = { w: 2317, h: 856 };
  const REF = { w: 1328, h: 320, ox: 20, oy: 695 };

  function rt(opts) {
    return window.TMAText.renderText(opts);
  }

  function esc(value) {
    return window.TMAText.esc(value);
  }

  function place(x, y, w, h, html, nodeId) {
    const size = w != null && h != null ? `width:${w}px;height:${h}px;` : '';
    return `<div class="tma-text-inst__node" style="left:${x}px;top:${y}px;${size}" data-node-id="${esc(nodeId)}">${html}</div>`;
  }

  function refPlace(x, y, w, h, html, nodeId) {
    return place(x - REF.ox, y - REF.oy, w, h, html, nodeId);
  }

  function renderMainBoard() {
    const parts = [];

    parts.push(place(100, 100, 400, 36, rt({
      mode: 'single',
      text: '14 Users remaining until your plan requires update',
      style: '14',
      color: 'secondary',
      borderBottom: true,
      nodeId: 'I32708:1070;10892:2493',
    }), '32708:1070'));

    parts.push(place(100, 146, 400, 56, rt({
      mode: 'stack',
      borderBottom: true,
      lines: [
        { text: 'Active until Dec 9, 2022', style: '14-semibold', color: 'primary' },
        { text: 'We will send you a notification upon Subscription expiration.', color: 'secondary' },
      ],
      nodeId: 'I32708:1071;10892:2538',
    }), '32708:1071'));

    parts.push(place(100, 212, 400, 40, rt({
      mode: 'stack',
      lines: [
        { text: '$24.99 Per Month', style: '14-semibold', color: 'primary' },
        { text: 'Extended Pro Package. Up to 100 Agents & 25 Projects.', color: 'secondary' },
      ],
      nodeId: 'I32708:1072;10892:2538',
    }), '32708:1072'));

    parts.push(place(100, 262, 400, 48, rt({
      mode: 'single',
      text: 'Plan your blog post by choosing a topic, creating an outline conduct research, and checking facts.',
      style: '12',
      color: 'secondary',
      borderBottom: true,
      nodeId: 'I32708:1073;10892:2493',
    }), '32708:1073'));

    parts.push(place(100, 324, 183, 20, rt({
      mode: 'link',
      parts: [
        { text: 'Not a Member yet? ', color: 'secondary' },
        { text: 'Sign Up', link: true },
      ],
      nodeId: 'I32708:1074;10892:2493',
    }), '32708:1074'));

    parts.push(place(100, 354, 221, 20, rt({
      mode: 'link',
      parts: [
        { text: 'Already have an Account? ', color: 'secondary' },
        { text: 'Sign in', link: true },
      ],
      nodeId: 'I32708:1075;10892:2493',
    }), '32708:1075'));

    parts.push(place(100, 384, 259, 20, rt({
      mode: 'link',
      parts: [
        { text: 'Didn\u2019t get the code ? ', color: 'secondary' },
        { text: 'Resend', link: true },
        { text: ' or ', color: 'secondary' },
        { text: 'Call Us', link: true },
      ],
      nodeId: 'I32708:1076;10892:2493',
    }), '32708:1076'));

    parts.push(place(100, 414, 144, 40, rt({
      mode: 'support',
      title: 'Need support?',
      link: 'byewind@twitter.com',
      nodeId: 'I32708:1088;10892:2538',
    }), '32708:1088'));

    parts.push(place(100, 464, 65, 48, rt({
      mode: 'stack',
      center: true,
      lines: [
        { text: 'percentage', style: '12', color: 'secondary' },
        { text: '58%', style: '24-semibold', color: 'primary' },
      ],
      nodeId: 'I32708:1065;10892:2538',
    }), '32708:1065'));

    parts.push(place(100, 528, 269, 48, rt({
      mode: 'multi-col',
      columns: [
        ['+852 19850622', 'byewind@twitter.com', 'snow.byewind.com'],
        ['One Apple Park Way', 'Cupertino, CA 95014'],
      ],
      nodeId: 'I32708:1066;12336:3564',
    }), '32708:1066'));

    parts.push(place(100, 592, 160, 20, rt({
      mode: 'inline',
      lines: [
        { text: 'Profile Details', semibold: true },
        { text: 'Edit Profile', color: 'secondary' },
      ],
      nodeId: 'I32708:1068;12336:3564',
    }), '32708:1068'));

    parts.push(place(100, 622, 157, 20, rt({
      mode: 'inline',
      lines: [
        { text: 'Stock Report', semibold: true },
        { text: 'View Stock', color: 'secondary' },
      ],
      nodeId: 'I32708:1067;12336:3564',
    }), '32708:1067'));

    parts.push(place(100, 652, 145, 20, rt({
      mode: 'inline',
      lines: [
        { text: 'Users', semibold: true },
        { text: '86 of 100 Used', color: 'secondary' },
      ],
      nodeId: 'I32708:1069;12336:3564',
    }), '32708:1069'));

    parts.push(place(612, 100, 152, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Sign Up', style: '24-semibold', color: 'primary' },
        { text: 'Your Social Campaigns', color: 'secondary' },
      ],
      nodeId: 'I32708:1078;10892:2538',
    }), '32708:1078'));

    parts.push(place(612, 174, 152, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Sign In', style: '24-semibold', color: 'primary' },
        { text: 'Your Social Campaigns', color: 'secondary' },
      ],
      nodeId: 'I32708:1077;10892:2538',
    }), '32708:1077'));

    parts.push(place(564, 248, 248, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Two Step Verification', style: '24-semibold', color: 'primary' },
        { text: 'Enter the verification code we sent to', color: 'secondary' },
      ],
      nodeId: 'I32708:1079;10892:2538',
    }), '32708:1079'));

    const helpLink = [
      { text: 'If you need more info, please check out ', color: 'secondary' },
      { text: 'Help Page', link: true },
      { text: '.', color: 'secondary' },
    ];

    parts.push(place(535, 322, 305, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Setup New Password', style: '24-semibold', color: 'primary' },
        { linkParts: [
          { text: 'Have you already reset the password ? ', color: 'secondary' },
          { text: 'Sign in', link: true },
        ] },
      ],
      nodeId: 'I32708:1080;10892:2538',
    }), '32708:1080'));

    parts.push(place(520, 396, 336, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Choose Account Type', style: '24-semibold', color: 'primary' },
        { linkParts: helpLink },
      ],
      nodeId: 'I32708:1081;10892:2538',
    }), '32708:1081'));

    parts.push(place(520, 470, 336, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Account Info', style: '24-semibold', color: 'primary' },
        { linkParts: helpLink },
      ],
      nodeId: 'I32708:1082;10892:2538',
    }), '32708:1082'));

    parts.push(place(520, 544, 336, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Billing Details', style: '24-semibold', color: 'primary' },
        { linkParts: helpLink },
      ],
      nodeId: 'I32708:1083;10892:2538',
    }), '32708:1083'));

    parts.push(place(520, 618, 336, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Billing Details', style: '24-semibold', color: 'primary' },
        { linkParts: helpLink },
      ],
      nodeId: 'I32708:1084;10892:2538',
    }), '32708:1084'));

    parts.push(place(555, 692, 267, 60, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Forgot Password ?', style: '24-semibold', color: 'primary' },
        { text: 'Enter your email to reset your password.', color: 'secondary' },
      ],
      nodeId: 'I32708:1085;10892:2538',
    }), '32708:1085'));

    parts.push(place(911, 100, 347, 86, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: '404 Not Found', style: '48-semibold', color: 'primary' },
        { text: 'Sorry, we can\u2019t find that page.', color: 'secondary' },
      ],
      nodeId: 'I32708:1087;10892:2538',
    }), '32708:1087'));

    parts.push(place(878, 196, 409, 82, rt({
      mode: 'stack',
      center: true,
      gap: 8,
      lines: [
        { text: 'Choose Your Plan', style: '48-semibold', color: 'primary' },
        { text: 'Simple pricing. No hidden fees. Advanced features for you business.', style: '12', color: 'secondary' },
      ],
      nodeId: 'I32708:1086;10892:2538',
    }), '32708:1086'));

    parts.push(place(1310, 100, 115, 20, rt({
      mode: 'inline',
      lines: [
        { text: '\uD83D\uDE09' },
        { text: 'Font Awesome' },
      ],
      nodeId: 'I32708:1089;12336:3564',
    }), '32708:1089'));

    parts.push(place(1310, 130, 117, 20, rt({
      mode: 'inline',
      lines: [
        { text: '\u2605' },
        { text: 'Font Awesome' },
      ],
      nodeId: 'I32708:1093;12336:3564',
    }), '32708:1093'));

    parts.push(place(1310, 160, 115, 20, rt({
      mode: 'inline',
      lines: [
        { text: '\u2665' },
        { text: 'Font Awesome' },
      ],
      nodeId: 'I32708:1094;12336:3564',
    }), '32708:1094'));

    parts.push(place(1310, 190, 54, 20, rt({
      mode: 'inline',
      lines: [
        { text: '\uD83D\uDE09' },
        { text: 'Emoji' },
      ],
      nodeId: 'I32708:1095;12336:3564',
    }), '32708:1095'));

    parts.push(place(1310, 220, 54, 20, rt({
      mode: 'inline',
      lines: [
        { text: '\uD83D\uDC4B' },
        { text: 'Emoji' },
      ],
      nodeId: 'I32708:1096;12336:3564',
    }), '32708:1096'));

    parts.push(place(1310, 250, 54, 20, rt({
      mode: 'inline',
      lines: [
        { text: '\uD83C\uDF1E' },
        { text: 'Emoji' },
      ],
      nodeId: 'I32708:1097;12336:3564',
    }), '32708:1097'));

    parts.push(place(1447, 100, 142, 96, rt({
      mode: 'card',
      cardType: 'gradient',
      text: 'Text',
      nodeId: 'I32708:1090;10892:2493',
    }), '32708:1090'));

    parts.push(place(1609, 100, 280, 128, rt({
      mode: 'card',
      cardType: 'notes',
      lines: [
        { text: '\uD83C\uDF1F\uFE0F Design notes', style: '18-semibold', color: 'white' },
        { text: 'You can skip this step to simplify the design process and take security risks at the same time.', style: '14', color: 'white' },
      ],
      nodeId: 'I32708:1092;10892:2538',
    }), '32708:1092'));

    parts.push(place(1909, 100, 305, 98, rt({
      mode: 'card',
      cardType: 'dark',
      text: 'Home page',
      nodeId: 'I32708:1091;10892:2493',
    }), '32708:1091'));

    return parts.join('');
  }

  function renderReferenceGrid() {
    const vertical = [
      { id: '32253:107823', x: 20, y: 695, w: 29, h: 20, count: 1 },
      { id: '32253:107822', x: 69, y: 695, w: 41, h: 40, count: 2 },
      { id: '32253:107821', x: 130, y: 695, w: 42, h: 60, count: 3 },
      { id: '32253:107820', x: 192, y: 695, w: 42, h: 80, count: 4 },
      { id: '32253:107819', x: 254, y: 695, w: 42, h: 100, count: 5 },
      { id: '32253:107818', x: 316, y: 695, w: 42, h: 120, count: 6 },
      { id: '32253:107817', x: 378, y: 695, w: 42, h: 140, count: 7 },
      { id: '32253:107810', x: 460, y: 695, w: 37, h: 20, count: 1 },
      { id: '32253:107809', x: 509, y: 695, w: 49, h: 40, count: 2 },
      { id: '32253:107808', x: 570, y: 695, w: 50, h: 60, count: 3 },
      { id: '32253:107807', x: 632, y: 695, w: 50, h: 80, count: 4 },
      { id: '32253:107806', x: 694, y: 695, w: 50, h: 100, count: 5 },
      { id: '32253:107805', x: 756, y: 695, w: 50, h: 120, count: 6 },
      { id: '32253:107804', x: 818, y: 695, w: 50, h: 140, count: 7 },
      { id: '32253:107797', x: 908, y: 695, w: 29, h: 20, count: 1 },
      { id: '32253:107796', x: 957, y: 695, w: 41, h: 40, count: 2 },
      { id: '32253:107795', x: 1018, y: 695, w: 42, h: 60, count: 3 },
      { id: '32253:107794', x: 1080, y: 695, w: 42, h: 80, count: 4 },
      { id: '32253:107793', x: 1142, y: 695, w: 42, h: 100, count: 5 },
      { id: '32253:107792', x: 1204, y: 695, w: 42, h: 120, count: 6 },
      { id: '32253:107791', x: 1266, y: 695, w: 42, h: 140, count: 7 },
    ];

    const horizontal = [
      { id: '32253:107816', x: 20, y: 755, w: 74, count: 1 },
      { id: '32253:107815', x: 20, y: 795, w: 120, count: 2 },
      { id: '32253:107814', x: 20, y: 835, w: 166, count: 3 },
      { id: '32253:107813', x: 20, y: 875, w: 211, count: 4 },
      { id: '32253:107811', x: 20, y: 915, w: 256, count: 5 },
      { id: '32253:107812', x: 20, y: 955, w: 301, count: 6 },
      { id: '32253:107803', x: 460, y: 755, w: 82, count: 1 },
      { id: '32253:107802', x: 460, y: 795, w: 128, count: 2 },
      { id: '32253:107801', x: 460, y: 835, w: 174, count: 3 },
      { id: '32253:107800', x: 460, y: 875, w: 219, count: 4 },
      { id: '32253:107799', x: 460, y: 915, w: 264, count: 5 },
      { id: '32253:107798', x: 460, y: 955, w: 309, count: 6 },
      { id: '32253:107790', x: 908, y: 755, w: 74, count: 1 },
      { id: '32253:107789', x: 908, y: 795, w: 120, count: 2 },
      { id: '32253:107788', x: 908, y: 835, w: 166, count: 3 },
      { id: '32253:107787', x: 908, y: 875, w: 211, count: 4 },
      { id: '32253:107786', x: 908, y: 915, w: 256, count: 5 },
      { id: '32253:107785', x: 908, y: 955, w: 301, count: 6 },
    ];

    const parts = [];
    vertical.forEach((item) => {
      parts.push(refPlace(item.x, item.y, item.w, item.h, rt({
        mode: 'count-vertical',
        count: item.count,
        nodeId: item.id,
      }), item.id));
    });
    horizontal.forEach((item) => {
      parts.push(refPlace(item.x, item.y, item.w, 20, rt({
        mode: 'count-horizontal',
        count: item.count,
        nodeId: item.id,
      }), item.id));
    });
    return parts.join('');
  }

  function renderInstances() {
    return `<div class="tma-text-demo__stage" data-text-showcase>
      <div class="tma-text-demo__board-wrap tma-text-demo__board-wrap--main">
        <div class="tma-text-demo__boards tma-text-demo__boards--main" data-board-main>
          <div class="tma-text-inst" data-node-id="32708:1064">${renderMainBoard()}</div>
        </div>
      </div>
      <div class="tma-text-demo__board-wrap tma-text-demo__board-wrap--ref">
        <div class="tma-text-demo__boards tma-text-demo__boards--ref" data-board-ref>
          <div class="tma-text-inst__ref" data-node-id="32253:107748">${renderReferenceGrid()}</div>
        </div>
      </div>
      ${renderResponsiveLayout()}
    </div>`;
  }

  function responsiveItem(nodeId, opts, cls) {
    const extra = cls ? ` ${cls}` : '';
    return `<div class="tma-text-inst-responsive__item${extra}" data-node-id="${esc(nodeId)}">${rt(opts)}</div>`;
  }

  function renderResponsiveLayout() {
    const helpLink = [
      { text: 'If you need more info, please check out ', color: 'secondary' },
      { text: 'Help Page', link: true },
      { text: '.', color: 'secondary' },
    ];

    return `<div class="tma-text-inst-responsive" data-node-id="32708:1064-responsive">
      <section class="tma-text-inst-responsive__section">
        <h3 class="tma-text-inst-responsive__heading">Subscription &amp; account</h3>
        <div class="tma-text-inst-responsive__grid">
          ${responsiveItem('32708:1070', { mode: 'single', text: '14 Users remaining until your plan requires update', style: '14', color: 'secondary', borderBottom: true })}
          ${responsiveItem('32708:1071', { mode: 'stack', borderBottom: true, lines: [{ text: 'Active until Dec 9, 2022', style: '14-semibold', color: 'primary' }, { text: 'We will send you a notification upon Subscription expiration.', color: 'secondary' }] })}
          ${responsiveItem('32708:1072', { mode: 'stack', lines: [{ text: '$24.99 Per Month', style: '14-semibold', color: 'primary' }, { text: 'Extended Pro Package. Up to 100 Agents & 25 Projects.', color: 'secondary' }] })}
          ${responsiveItem('32708:1073', { mode: 'single', text: 'Plan your blog post by choosing a topic, creating an outline conduct research, and checking facts.', style: '12', color: 'secondary', borderBottom: true })}
          ${responsiveItem('32708:1074', { mode: 'link', parts: [{ text: 'Not a Member yet? ', color: 'secondary' }, { text: 'Sign Up', link: true }] })}
          ${responsiveItem('32708:1075', { mode: 'link', parts: [{ text: 'Already have an Account? ', color: 'secondary' }, { text: 'Sign in', link: true }] })}
          ${responsiveItem('32708:1076', { mode: 'link', parts: [{ text: 'Didn\u2019t get the code ? ', color: 'secondary' }, { text: 'Resend', link: true }, { text: ' or ', color: 'secondary' }, { text: 'Call Us', link: true }] })}
          ${responsiveItem('32708:1088', { mode: 'support', title: 'Need support?', link: 'byewind@twitter.com' })}
          ${responsiveItem('32708:1065', { mode: 'stack', center: true, lines: [{ text: 'percentage', style: '12', color: 'secondary' }, { text: '58%', style: '24-semibold', color: 'primary' }] }, 'tma-text-inst-responsive__item--narrow')}
          ${responsiveItem('32708:1066', { mode: 'multi-col', columns: [['+852 19850622', 'byewind@twitter.com', 'snow.byewind.com'], ['One Apple Park Way', 'Cupertino, CA 95014']] })}
          ${responsiveItem('32708:1068', { mode: 'inline', lines: [{ text: 'Profile Details', semibold: true }, { text: 'Edit Profile', color: 'secondary' }] })}
          ${responsiveItem('32708:1067', { mode: 'inline', lines: [{ text: 'Stock Report', semibold: true }, { text: 'View Stock', color: 'secondary' }] })}
          ${responsiveItem('32708:1069', { mode: 'inline', lines: [{ text: 'Users', semibold: true }, { text: '86 of 100 Used', color: 'secondary' }] })}
        </div>
      </section>
      <section class="tma-text-inst-responsive__section">
        <h3 class="tma-text-inst-responsive__heading">Auth &amp; form headers</h3>
        <div class="tma-text-inst-responsive__grid">
          ${responsiveItem('32708:1078', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Sign Up', style: '24-semibold', color: 'primary' }, { text: 'Your Social Campaigns', color: 'secondary' }] })}
          ${responsiveItem('32708:1077', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Sign In', style: '24-semibold', color: 'primary' }, { text: 'Your Social Campaigns', color: 'secondary' }] })}
          ${responsiveItem('32708:1079', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Two Step Verification', style: '24-semibold', color: 'primary' }, { text: 'Enter the verification code we sent to', color: 'secondary' }] })}
          ${responsiveItem('32708:1080', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Setup New Password', style: '24-semibold', color: 'primary' }, { linkParts: [{ text: 'Have you already reset the password ? ', color: 'secondary' }, { text: 'Sign in', link: true }] }] })}
          ${responsiveItem('32708:1081', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Choose Account Type', style: '24-semibold', color: 'primary' }, { linkParts: helpLink }] })}
          ${responsiveItem('32708:1082', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Account Info', style: '24-semibold', color: 'primary' }, { linkParts: helpLink }] })}
          ${responsiveItem('32708:1083', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Billing Details', style: '24-semibold', color: 'primary' }, { linkParts: helpLink }] })}
          ${responsiveItem('32708:1085', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Forgot Password ?', style: '24-semibold', color: 'primary' }, { text: 'Enter your email to reset your password.', color: 'secondary' }] })}
        </div>
      </section>
      <section class="tma-text-inst-responsive__section">
        <h3 class="tma-text-inst-responsive__heading">Display headings</h3>
        <div class="tma-text-inst-responsive__grid">
          ${responsiveItem('32708:1087', { mode: 'stack', center: true, gap: 8, lines: [{ text: '404 Not Found', style: '48-semibold', color: 'primary' }, { text: 'Sorry, we can\u2019t find that page.', color: 'secondary' }] })}
          ${responsiveItem('32708:1086', { mode: 'stack', center: true, gap: 8, lines: [{ text: 'Choose Your Plan', style: '48-semibold', color: 'primary' }, { text: 'Simple pricing. No hidden fees. Advanced features for you business.', style: '12', color: 'secondary' }] })}
        </div>
      </section>
      <section class="tma-text-inst-responsive__section">
        <h3 class="tma-text-inst-responsive__heading">Inline pairs &amp; icons</h3>
        <div class="tma-text-inst-responsive__grid tma-text-inst-responsive__grid--row">
          ${responsiveItem('32708:1089', { mode: 'inline', lines: [{ text: '\uD83D\uDE09' }, { text: 'Font Awesome' }] })}
          ${responsiveItem('32708:1093', { mode: 'inline', lines: [{ text: '\u2605' }, { text: 'Font Awesome' }] })}
          ${responsiveItem('32708:1094', { mode: 'inline', lines: [{ text: '\u2665' }, { text: 'Font Awesome' }] })}
          ${responsiveItem('32708:1095', { mode: 'inline', lines: [{ text: '\uD83D\uDE09' }, { text: 'Emoji' }] })}
          ${responsiveItem('32708:1096', { mode: 'inline', lines: [{ text: '\uD83D\uDC4B' }, { text: 'Emoji' }] })}
          ${responsiveItem('32708:1097', { mode: 'inline', lines: [{ text: '\uD83C\uDF1E' }, { text: 'Emoji' }] })}
        </div>
      </section>
      <section class="tma-text-inst-responsive__section">
        <h3 class="tma-text-inst-responsive__heading">Styled cards</h3>
        <div class="tma-text-inst-responsive__grid tma-text-inst-responsive__grid--row">
          ${responsiveItem('32708:1090', { mode: 'card', cardType: 'gradient', text: 'Text' }, 'tma-text-inst-responsive__item--card')}
          ${responsiveItem('32708:1092', { mode: 'card', cardType: 'notes', lines: [{ text: '\uD83C\uDF1F\uFE0F Design notes', style: '18-semibold', color: 'white' }, { text: 'You can skip this step to simplify the design process and take security risks at the same time.', style: '14', color: 'white' }] }, 'tma-text-inst-responsive__item--card')}
          ${responsiveItem('32708:1091', { mode: 'card', cardType: 'dark', text: 'Home page' }, 'tma-text-inst-responsive__item--card')}
        </div>
      </section>
      <section class="tma-text-inst-responsive__section">
        <h3 class="tma-text-inst-responsive__heading">Count reference</h3>
        <div class="tma-text-inst-responsive__ref-board" data-ref-responsive>
          <div class="tma-text-inst__ref-inner" style="width:${REF.w}px;height:${REF.h}px">
            <div class="tma-text-inst__ref" data-node-id="32253:107748">${renderReferenceGrid()}</div>
          </div>
        </div>
      </section>
    </div>`;
  }

  function fitBoard(wrap, board, designW, designH) {
    if (!wrap || !board) return;
    const available = wrap.clientWidth;
    const scale = Math.min(1, available / designW);
    board.style.transform = scale < 1 ? `scale(${scale})` : '';
    wrap.style.height = `${Math.ceil(designH * scale)}px`;
  }

  function fitResponsiveRef(stage) {
    const host = stage && stage.querySelector('[data-ref-responsive]');
    const inner = host && host.querySelector('.tma-text-inst__ref-inner');
    if (!host || !inner) return;
    const available = host.clientWidth;
    const scale = Math.min(1, available / REF.w);
    inner.style.transform = scale < 1 ? `scale(${scale})` : '';
    host.style.height = `${Math.ceil(REF.h * scale)}px`;
  }

  function fitShowcase(root) {
    const stage = root && root.querySelector('[data-text-showcase]');
    if (!stage) return;

    const mainWrap = stage.querySelector('.tma-text-demo__board-wrap--main');
    const mainBoard = stage.querySelector('[data-board-main]');
    const refWrap = stage.querySelector('.tma-text-demo__board-wrap--ref');
    const refBoard = stage.querySelector('[data-board-ref]');

    if (window.matchMedia('(max-width: 900px)').matches) {
      if (mainBoard) mainBoard.style.transform = '';
      if (refBoard) refBoard.style.transform = '';
      if (mainWrap) mainWrap.style.height = '';
      if (refWrap) refWrap.style.height = '';
      fitResponsiveRef(stage);
      return;
    }

    const refInner = stage.querySelector('[data-ref-responsive] .tma-text-inst__ref-inner');
    if (refInner) refInner.style.transform = '';

    fitBoard(mainWrap, mainBoard, BOARD.w, BOARD.h);
    fitBoard(refWrap, refBoard, REF.w, REF.h);
  }

  function mountInstances(el) {
    if (!el) return;
    el.innerHTML = renderInstances();
    const fit = () => fitShowcase(el);
    fit();
    window.addEventListener('resize', fit);
  }

  window.TMATextInstances = {
    mountInstances,
    renderInstances,
    fitShowcase,
    BOARD,
    REF,
  };
})();
