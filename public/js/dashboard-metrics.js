/*
 * TMA — Default Dashboard metrics (Figma 32546:96097 / 32546:96098)
 * Global: window.TMADashboardMetrics
 */
(function () {
  'use strict';

  function render() {
    return '<div class="tma-dash__grid" data-node-id="32546:96097">' +
      '<div class="tma-dash__cards">' +
      '<article class="tma-dash__card tma-dash__card--blue">' +
      '<div class="tma-dash__card-head"><span class="tma-dash__card-label">Total Projects</span>' +
      '<img class="tma-dash__card-ico" src="images/icons/phosphor/FolderNotch.svg" alt=""></div>' +
      '<div class="tma-dash__card-row"><div class="tma-dash__card-value">29</div>' +
      '<div class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">+11.02%</span><img src="images/icons/tma/ArrowRise.svg" alt="up"></div></div></article>' +
      '<article class="tma-dash__card tma-dash__card--purple">' +
      '<div class="tma-dash__card-head"><span class="tma-dash__card-label">Total Tasks</span>' +
      '<img class="tma-dash__card-ico" src="images/icons/phosphor/ListChecks.svg" alt=""></div>' +
      '<div class="tma-dash__card-row"><div class="tma-dash__card-value">715</div>' +
      '<div class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">-0.03%</span><img src="images/icons/tma/ArrowFall.svg" alt="down"></div></div></article>' +
      '<article class="tma-dash__card tma-dash__card--blue">' +
      '<div class="tma-dash__card-head"><span class="tma-dash__card-label">Members</span>' +
      '<img class="tma-dash__card-ico" src="images/icons/phosphor/UsersThree.svg" alt=""></div>' +
      '<div class="tma-dash__card-row"><div class="tma-dash__card-value">31</div>' +
      '<div class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">+15.03%</span><img src="images/icons/tma/ArrowRise.svg" alt="up"></div></div></article>' +
      '<article class="tma-dash__card tma-dash__card--purple">' +
      '<div class="tma-dash__card-head"><span class="tma-dash__card-label">Productivity</span>' +
      '<img class="tma-dash__card-ico" src="images/icons/phosphor/BatteryCharging.svg" alt=""></div>' +
      '<div class="tma-dash__card-row"><div class="tma-dash__card-value">93.8%</div>' +
      '<div class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">+6.08%</span><img src="images/icons/tma/ArrowRise.svg" alt="up"></div></div></article>' +
      '</div>' +
      '<div class="tma-dash__panels">' +
      '<section class="tma-dash__panel tma-dash__panel--status">' +
      '<div class="tma-dash__panel-title">Project Status</div>' +
      '<svg class="tma-dash__donut" viewBox="0 0 120 120" aria-hidden="true">' +
      '<g transform="rotate(-90 60 60)" fill="none" stroke-width="18" stroke-linecap="round">' +
      '<circle cx="60" cy="60" r="44" stroke="var(--color-black)" stroke-dasharray="183 93.46" stroke-dashoffset="0"/>' +
      '<circle cx="60" cy="60" r="44" stroke="var(--chart-green)" stroke-dasharray="69 207.46" stroke-dashoffset="-186.9"/>' +
      '<circle cx="60" cy="60" r="44" stroke="var(--chart-cyan)" stroke-dasharray="13 263.46" stroke-dashoffset="-259.9"/>' +
      '</g></svg>' +
      '<div class="tma-dash__status-legend">' +
      '<div class="tma-dash__legend-row"><span class="tma-dash__legend-name"><i class="tma-dash__dot tma-dash__dot--black"></i>Competed</span><span class="tma-dash__legend-value">67.6%</span></div>' +
      '<div class="tma-dash__legend-row"><span class="tma-dash__legend-name"><i class="tma-dash__dot tma-dash__dot--green"></i>In Progress</span><span class="tma-dash__legend-value">26.4%</span></div>' +
      '<div class="tma-dash__legend-row"><span class="tma-dash__legend-name"><i class="tma-dash__dot tma-dash__dot--cyan"></i>Behind</span><span class="tma-dash__legend-value">6%</span></div>' +
      '</div></section>' +
      '<section class="tma-dash__panel tma-dash__panel--tasklist">' +
      '<div class="tma-dash__panel-title">Tasks</div>' +
      '<div class="tma-dash__tasks">' +
      '<div class="tma-dash__tasks-head">' +
      '<div class="tma-dash__th">Title</div><div class="tma-dash__th">Assigned to</div><div class="tma-dash__th">Time Spend</div><div class="tma-dash__th">Status</div>' +
      '</div>' +
      '<div class="tma-dash__tasks-row">' +
      '<div class="tma-dash__td">Coffee detail page</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__avatars"><img class="tma-dash__avatar" src="images/avatars/AvatarMale05.png" alt=""></span></div>' +
      '<div class="tma-dash__td">3hr 20min</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__chip tma-dash__chip--purple"><i class="tma-dash__chip-dot"></i>In Progress</span></div>' +
      '</div>' +
      '<div class="tma-dash__tasks-row">' +
      '<div class="tma-dash__td">Drinking bottle graphics</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__avatars"><img class="tma-dash__avatar" src="images/avatars/AvatarAbstract01.png" alt=""><img class="tma-dash__avatar" src="images/avatars/AvatarFemale05.png" alt=""></span></div>' +
      '<div class="tma-dash__td">12hr 21min</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__chip tma-dash__chip--green"><i class="tma-dash__chip-dot"></i>Complete</span></div>' +
      '</div>' +
      '<div class="tma-dash__tasks-row">' +
      '<div class="tma-dash__td">App design and development</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__avatars"><img class="tma-dash__avatar" src="images/avatars/AvatarFemale04.png" alt=""><img class="tma-dash__avatar" src="images/avatars/AvatarMale05.png" alt=""><span class="tma-dash__avatar tma-dash__avatar--more">+3</span></span></div>' +
      '<div class="tma-dash__td">78hr 5min</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__chip tma-dash__chip--blue"><i class="tma-dash__chip-dot"></i>Pending</span></div>' +
      '</div>' +
      '<div class="tma-dash__tasks-row">' +
      '<div class="tma-dash__td">Poster illustation design</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__avatars"><img class="tma-dash__avatar" src="images/avatars/Avatar3d03.png" alt=""><img class="tma-dash__avatar" src="images/avatars/AvatarAbstract02.png" alt=""></span></div>' +
      '<div class="tma-dash__td">26hr 58min</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__chip tma-dash__chip--orange"><i class="tma-dash__chip-dot"></i>Approved</span></div>' +
      '</div>' +
      '<div class="tma-dash__tasks-row">' +
      '<div class="tma-dash__td">App UI design</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__avatars"><img class="tma-dash__avatar" src="images/avatars/AvatarMale01.png" alt=""></span></div>' +
      '<div class="tma-dash__td">17hr 22min</div>' +
      '<div class="tma-dash__td"><span class="tma-dash__chip tma-dash__chip--muted"><i class="tma-dash__chip-dot"></i>Rejected</span></div>' +
      '</div>' +
      '</div></section>' +
      '<section class="tma-dash__panel tma-dash__panel--overview">' +
      '<div class="tma-dash__panel-title">Tasks Overview</div>' +
      '<div class="tma-dash__barchart">' +
      '<div class="tma-dash__axis-y"><span>30K</span><span>20K</span><span>10K</span><span>0</span></div>' +
      '<div class="tma-dash__bars"><div class="tma-dash__bars-track">' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--red" style="height:50%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--primary" style="height:87.5%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--red" style="height:62.5%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--primary" style="height:100%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--red" style="height:37.5%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--primary" style="height:75%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--red" style="height:50%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--primary" style="height:87.5%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--red" style="height:62.5%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--primary" style="height:100%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--red" style="height:37.5%"></i></div>' +
      '<div class="tma-dash__bar-col"><i class="tma-dash__vbar tma-dash__vbar--primary" style="height:75%"></i></div>' +
      '</div><div class="tma-dash__axis-x--abs">' +
      '<span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span>' +
      '<span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span>' +
      '</div></div></div></section>' +
      '</div></div>';
  }

  function mount(container) {
    if (!container) return;
    container.innerHTML = render();
  }

  window.TMADashboardMetrics = { mount: mount, render: render };
})();
