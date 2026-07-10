/* TMA — Card instances board (Figma 33160:10064) */
(function () {
  'use strict';

  const C = () => window.TMACard;

  function due(month, day, year) {
    return `Due Date: ${month} ${day}, ${year}`;
  }

  function board(w, h, html) {
    return `<div class="tma-card-instances-page__board-wrap"><div class="tma-card-instances-page__board" style="width:${w}px;height:${h}px">${html}</div></div>`;
  }

  function place(left, top, html, nodeId, w, h) {
    let style = `left:${left}px;top:${top}px`;
    if (w != null) style += `;width:${w}px`;
    if (h != null) style += `;height:${h}px`;
    return `<div class="tma-card-instances-page__card" style="${style}" data-node-id="${nodeId}">${html}</div>`;
  }

  function render2266() {
    return C().renderCodeBlock({ nodeId: '33250:2266' });
  }

  function render10066() {
    return C().renderStatCard({
      nodeId: '33160:10066',
      label: 'Current Projects',
      value: '268',
      trend: '+11.02%',
      trendUp: true,
      bg: '#edeefc',
      icon: 'FolderNotch',
    });
  }

  function render10067() {
    return C().renderStatCard({
      nodeId: '33160:10067',
      label: 'Project Finance',
      value: '$3,290',
      trend: '-0.03%',
      trendUp: false,
      bg: '#e6f1fd',
      icon: 'CurrencyCircleDollar',
    });
  }

  function render10068() {
    return C().renderStatCard({
      nodeId: '33160:10068',
      label: 'Our Clients',
      value: '31',
      trend: '+15.03%',
      trendUp: true,
      bg: '#edeefc',
      icon: 'UsersThree',
    });
  }

  function render10069() {
    return C().renderProgressCard({
      nodeId: '33160:10069',
      title: 'TMA',
      dueDate: due('Nov', 10, 2022),
      status: 'In Progress',
      statusColor: 'purple',
      completed: 36,
      total: 49,
      percent: 75,
      logoIcon: 'SnowLogo',
      avatar: 'AvatarByewind',
    });
  }

  function render10070() {
    return C().renderProgressCard({
      nodeId: '33160:10070',
      title: 'Coffee detail page - Main Page',
      dueDate: due('Nov', 10, 2022),
      status: 'Complete',
      statusColor: 'green',
      completed: 56,
      total: 56,
      percent: 100,
      logoIcon: 'Copilot',
      avatar: 'AvatarFemale04',
    });
  }

  function render10071() {
    return C().renderProgressCard({
      nodeId: '33160:10071',
      title: 'Drinking bottle graphics',
      dueDate: due('Nov', 10, 2022),
      status: 'Rejected',
      statusColor: 'gray',
      completed: 16,
      total: 65,
      percent: 45,
      logoIcon: 'Behance',
      avatar: 'Avatar3d04',
    });
  }

  function render10072() {
    return C().renderProgressCard({
      nodeId: '33160:10072',
      title: 'Company logo design',
      dueDate: due('Feb', 21, 2022),
      status: 'Complete',
      statusColor: 'green',
      completed: 20,
      total: 20,
      percent: 100,
      logoIcon: 'Dropbox',
      avatar: 'AvatarAbstract04',
    });
  }

  function render10073() {
    return C().renderProgressCard({
      nodeId: '33160:10073',
      title: 'Landing page design',
      dueDate: due('Jun', 20, 2020),
      status: 'Pending',
      statusColor: 'blue',
      completed: 5,
      total: 23,
      percent: 36,
      logoIcon: 'ChatGPT',
      avatarGroup: ['AvatarByewind', 'AvatarFemale05', 3],
    });
  }

  function render10074() {
    return C().renderProgressCard({
      nodeId: '33160:10074',
      title: 'Product page redesign',
      dueDate: due('Jun', 20, 2020),
      status: 'In Progress',
      statusColor: 'purple',
      completed: 12,
      total: 49,
      percent: 38,
      logoIcon: 'Dribbble',
      avatar: 'AvatarMale02',
    });
  }

  function render10075() {
    return C().renderProgressCard({
      nodeId: '33160:10075',
      title: 'Coffee detail page',
      dueDate: due('Jun', 24, 2024),
      status: 'Rejected',
      statusColor: 'gray',
      completed: 8,
      total: 12,
      percent: 68,
      logoIcon: 'Messenger',
      avatar: 'AvatarMale01',
    });
  }

  function render10076() {
    return C().renderProgressCard({
      nodeId: '33160:10076',
      title: 'Aviasales App',
      dueDate: due('Oct', 25, 2025),
      status: 'Approved',
      statusColor: 'orange',
      completed: 17,
      total: 20,
      percent: 70,
      logoIcon: 'Loop',
      avatar: 'AvatarFemale06',
      stripColor: 'yellow',
      fullStrip: true,
    });
  }

  function render10077() {
    return C().renderProgressCard({
      nodeId: '33160:10077',
      title: 'Finance Dispatch',
      dueDate: due('Nov', 10, 2022),
      status: 'Pending',
      statusColor: 'blue',
      completed: 2,
      total: 19,
      percent: 17,
      logoIcon: 'Slack',
      avatar: 'AvatarAbstract01',
    });
  }

  function render10078() {
    return C().renderProgressCard({
      nodeId: '33160:10078',
      title: 'Fitnes App',
      dueDate: due('Nov', 10, 2022),
      status: 'Pending',
      statusColor: 'blue',
      completed: 20,
      total: 48,
      percent: 45,
      logoIcon: 'Figma',
      avatar: 'AvatarMale04',
    });
  }

  function render10079() {
    return C().renderProgressCard({
      nodeId: '33160:10079',
      title: 'Atica Banking',
      dueDate: due('Jun', 20, 2020),
      status: 'In Progress',
      statusColor: 'purple',
      completed: 35,
      total: 49,
      percent: 66,
      logoIcon: 'Github',
      avatar: 'AvatarAbstract02',
    });
  }

  function render10080() {
    return C().renderProgressCard({
      nodeId: '33160:10080',
      title: 'Coffee detail page',
      dueDate: due('Jun', 24, 2024),
      status: 'Rejected',
      statusColor: 'gray',
      completed: 2,
      total: 12,
      percent: 10,
      logoIcon: 'PriorityMedium',
      avatar: 'Avatar3d03',
    });
  }

  function render10081() {
    return C().renderTaskCard({
      nodeId: '33160:10081',
      tag: 'Technical Debt Reduction',
      title: 'Meeting with customer',
      description: 'Reduce technical debt by refactoring legacy code and improving architecture design.',
      avatar: 'AvatarByewind',
      attachments: 6,
      comments: 12,
    });
  }

  function render10082() {
    return C().renderTaskCard({
      nodeId: '33160:10082',
      tag: 'Code Quality',
      title: 'Sales report page',
      description: 'Increase code quality through code reviews and automated testing.',
      avatar: 'AvatarFemale05',
      attachments: 8,
      comments: 15,
    });
  }

  function render10083() {
    return C().renderTaskCard({
      nodeId: '33160:10083',
      tag: 'Performance Optimization',
      title: 'Branding Logo',
      description: 'Optimize application performance to improve user experience and reduce load times.',
      avatar: 'Avatar3d01',
      attachments: 2,
      comments: 15,
    });
  }

  function render10084() {
    return C().renderTaskCard({
      nodeId: '33160:10084',
      tag: 'User Experience',
      title: 'User Module Testing',
      description: 'Enhance user experience through intuitive design and seamless interactions.',
      avatar: 'AvatarFemale01',
      attachments: 9,
      comments: 19,
    });
  }

  function render10085() {
    return C().renderTaskCard({
      nodeId: '33160:10085',
      tag: 'Feature Development',
      title: 'Meeting with customer',
      description: 'Implement new features and functionality to meet customer needs and stay competitive.',
      avatarGroup: ['Avatar3d01', 'AvatarFemale04', 3],
      attachments: 6,
      comments: 82,
    });
  }

  function render10086() {
    return C().renderTaskCard({
      nodeId: '33160:10086',
      tag: 'Security Enhancement',
      title: 'API integration',
      description: 'Reduce technical debt by refactoring legacy code and improving architecture design.',
      avatar: 'AvatarMale03',
      attachments: 4,
      comments: 11,
    });
  }

  function render10087() {
    return C().renderTaskCard({
      nodeId: '33160:10087',
      tag: 'Documentation Update',
      title: 'Design main Dashboard',
      description: 'Reduce technical debt by refactoring legacy code and improving architecture design.',
      avatar: 'AvatarFemale02',
      attachments: 3,
      comments: 7,
    });
  }

  function render10088() {
    return C().renderTaskCard({
      nodeId: '33160:10088',
      tag: 'Scalability Enhancement',
      title: 'Design main Dashboard',
      description: 'Reduce technical debt by refactoring legacy code and improving architecture design.',
      avatar: 'AvatarAbstract02',
      attachments: 8,
      comments: 22,
    });
  }

  function render10089() {
    return C().renderTaskCard({
      nodeId: '33160:10089',
      tag: 'Testing Improvement',
      title: 'User onboarding flow',
      description: 'Reduce technical debt by refactoring legacy code and improving architecture design.',
      avatar: 'Avatar3d02',
      attachments: 5,
      comments: 14,
    });
  }

  function render10090() {
    return C().renderTaskCard({
      nodeId: '33160:10090',
      tag: 'Collaboration Improvement',
      title: 'Sales report page',
      description: 'Reduce technical debt by refactoring legacy code and improving architecture design.',
      avatar: 'AvatarAbstract01',
      attachments: 8,
      comments: 21,
    });
  }

  function render10091() {
    return C().renderTaskCard({
      nodeId: '33160:10091',
      tag: 'Maintenance Planning',
      title: 'Dashboard widgets',
      description: 'Reduce technical debt by refactoring legacy code and improving architecture design.',
      avatar: 'AvatarMale05',
      attachments: 7,
      comments: 18,
    });
  }

  function render10092() {
    return C().renderTaskCard({
      nodeId: '33160:10092',
      tag: 'Innovation Initiative',
      title: 'Mobile app redesign',
      description: 'Reduce technical debt by refactoring legacy code and improving architecture design.',
      avatar: 'AvatarFemale03',
      attachments: 10,
      comments: 25,
    });
  }

  function render10093() {
    return C().renderPriceCard({
      nodeId: '33160:10093',
      title: 'PRO version',
      price: '$9.9',
    });
  }

  function render10094() {
    return C().renderPriceCard({
      nodeId: '33160:10094',
      title: 'PRO TEAM',
      price: '$19.9',
    });
  }

  function render10095() {
    return C().renderPriceCard({
      nodeId: '33160:10095',
      title: 'PRO ENTERPRISE',
      price: '$29.9',
    });
  }

  function render10096() {
    return C().renderUsageCard({
      nodeId: '33160:10096',
      title: 'Precise Usage',
      description: 'Less than $5,000 per transaction.',
      selected: true,
      radio: true,
    });
  }

  function render10097() {
    return C().renderUsageCard({
      nodeId: '33160:10097',
      title: 'Normal Usage',
      description: 'More than $5,000 per transaction.',
      selected: false,
      radio: true,
    });
  }

  function render10098() {
    return C().renderUsageCard({
      nodeId: '33160:10098',
      title: 'Extreme Usage',
      description: 'More than $50,000 per transaction.',
      selected: false,
      radio: true,
    });
  }

  function render10099() {
    return C().renderCreditCard({
      nodeId: '33160:10099',
      name: 'ByeWind',
      status: 'Active',
      hover: true,
      edit: true,
    });
  }

  function render10100() {
    return C().renderCreditCard({
      nodeId: '33160:10100',
      variant: 'compact',
      name: 'ByeWind',
      cardType: 'mastercard',
      groups: ['1235', '6321', '1343', '7542'],
    });
  }

  function render10101() {
    return C().renderCreditCard({
      nodeId: '33160:10101',
      variant: 'button',
      name: 'PayPal',
      email: 'byewind@twitter.com',
    });
  }

  function render10102() {
    return C().renderAddressCard({
      nodeId: '33160:10102',
      label: "ByeWind's house",
      lines: ['One Apple Park Way', 'Cupertino, CA 95014', 'US'],
      status: 'Active',
      active: true,
      edit: true,
    });
  }

  function render10103() {
    return C().renderAddressCard({
      nodeId: '33160:10103',
      label: 'Company',
      lines: ['Ap #285-7193 Ullamcorper Avenue', 'Amesbury HI 93373', 'US'],
      static: true,
      hover: false,
    });
  }

  function render10104() {
    return C().renderAddAddressCard({ nodeId: '33160:10104' });
  }

  function renderInstancesBoard() {
    return board(4589, 1016, [
      place(100, 100, render2266(), '33250:2266', 653, 640),
      place(773, 100, render10066(), '33160:10066', 280, 112),
      place(1063, 100, render10067(), '33160:10067', 280, 112),
      place(1353, 100, render10068(), '33160:10068', 280, 112),
      place(773, 222, render10069(), '33160:10069', 280, 166),
      place(1063, 222, render10070(), '33160:10070', 280, 166),
      place(1353, 222, render10071(), '33160:10071', 280, 166),
      place(773, 398, render10072(), '33160:10072', 280, 166),
      place(1063, 398, render10073(), '33160:10073', 280, 166),
      place(1353, 398, render10074(), '33160:10074', 280, 166),
      place(773, 574, render10075(), '33160:10075', 280, 166),
      place(1063, 574, render10076(), '33160:10076', 280, 166),
      place(1353, 574, render10077(), '33160:10077', 280, 166),
      place(773, 750, render10078(), '33160:10078', 280, 166),
      place(1063, 750, render10079(), '33160:10079', 280, 166),
      place(1353, 750, render10080(), '33160:10080', 280, 166),
      place(1653, 100, render10081(), '33160:10081', 280, 164),
      place(1943, 100, render10082(), '33160:10082', 280, 164),
      place(2233, 100, render10083(), '33160:10083', 280, 164),
      place(1653, 274, render10084(), '33160:10084', 280, 164),
      place(1943, 274, render10085(), '33160:10085', 280, 164),
      place(2233, 274, render10086(), '33160:10086', 280, 164),
      place(1653, 448, render10087(), '33160:10087', 280, 164),
      place(1943, 448, render10088(), '33160:10088', 280, 164),
      place(2233, 448, render10089(), '33160:10089', 280, 164),
      place(1653, 622, render10090(), '33160:10090', 280, 164),
      place(1943, 622, render10091(), '33160:10091', 280, 164),
      place(2233, 622, render10092(), '33160:10092', 280, 164),
      place(2533, 100, render10096(), '33160:10096', 260),
      place(2803, 100, render10097(), '33160:10097', 260),
      place(3073, 100, render10098(), '33160:10098', 260),
      place(2533, 226, render10099(), '33160:10099', 260),
      place(2803, 226, render10100(), '33160:10100', 260),
      place(3073, 226, render10101(), '33160:10101', 260),
      place(2533, 379, render10102(), '33160:10102', 260),
      place(2803, 379, render10103(), '33160:10103', 260),
      place(3073, 376, render10104(), '33160:10104', 260),
      place(3353, 100, render10093(), '33160:10093', 372, 568),
      place(3735, 100, render10094(), '33160:10094', 372, 568),
      place(4117, 100, render10095(), '33160:10095', 372, 568),
    ].join(''));
  }

  function mountInstances(container) {
    if (!container || !C()) return;
    container.innerHTML = renderInstancesBoard();
  }

  window.TMACardInstances = {
    renderInstancesBoard,
    mountInstances,
    render2266,
    render10066,
    render10067,
    render10068,
    render10069,
    render10070,
    render10071,
    render10072,
    render10073,
    render10074,
    render10075,
    render10076,
    render10077,
    render10078,
    render10079,
    render10080,
    render10081,
    render10082,
    render10083,
    render10084,
    render10085,
    render10086,
    render10087,
    render10088,
    render10089,
    render10090,
    render10091,
    render10092,
    render10093,
    render10094,
    render10095,
    render10096,
    render10097,
    render10098,
    render10099,
    render10100,
    render10101,
    render10102,
    render10103,
    render10104,
  };
})();
