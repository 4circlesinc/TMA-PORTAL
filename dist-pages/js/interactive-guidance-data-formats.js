/* TMA - Data formats panel (Figma 30484:299253) */
(function () {
  'use strict';

  const DOC = window.TMAInteractiveGuidanceDoc;

  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEK_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const WEEK_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function renderDataFormats() {
    const topRow = `<div class="ig-data-formats__columns">
      ${DOC.renderDocSection('Month', DOC.renderListPair(MONTHS_FULL, MONTHS_SHORT))}
      ${DOC.renderDocSection('Week', DOC.renderListPair(WEEK_FULL, WEEK_SHORT))}
      ${DOC.renderDocSection('Time', `<div class="ig-doc__list-pair">
        ${DOC.renderOrderedList(['hour', 'minute', 'second'])}
        ${DOC.renderUnorderedList(['hr', 'min', 'sec'])}
        ${DOC.renderUnorderedList(['h', 'm', 's'])}
      </div>`)}
    </div>`;

    const dateTime = DOC.renderDocSection('Date and time', DOC.renderUnorderedList([
      '20:00', '8:00 AM', 'Today, 11:59 AM', 'Feb 2, 8:00 AM', 'Feb 2, 2026',
      'Feb 2, 2026, 8:00 AM', '2017-06-01T08:59:59Z', 'MM/DD/YYYY',
    ]));

    const dateRanges = DOC.renderDocSection('Date and time ranges', DOC.renderUnorderedList([
      '20:00 - 00:00', '8:00 - 11:59 AM', 'Feb 2, 11:59 AM - Mar 3, 12:00 PM',
      'Feb 2 - 10, 2026', 'Feb 2, 2026 - Mar 3, 2026',
      'Feb 2, 2022, 11:59 AM - Mar 3, 2026, 12:00 PM',
      '2017-06-01T08:59:59Z / 2017-06-10T12:00:00Z', 'MM/DD/YYYY - MM/DD/YYYY',
    ]));

    const pastFuture = `<section class="ig-doc__section">
      <div class="ig-data-formats__past-future-head">
        <h3 class="ig-doc__heading">Past</h3>
        <h3 class="ig-doc__heading">Future</h3>
      </div>
      <div class="ig-doc__list-pair">
        ${DOC.renderUnorderedList(['Just now', '1 minute ago', '1 hour ago', '2 hours ago', 'Yesterday, 8:00 AM', '1 day ago', '1 week ago'])}
        ${DOC.renderUnorderedList(['Shortly', 'In 1 minute', 'In 1 hour', 'In 2 hours', 'Tomorrow, 8:00 AM', 'In 1 day', 'In 1 week'])}
      </div>
    </section>`;

    const common = DOC.renderDocSection('Commonly used', `<div class="ig-doc__list-pair">
      ${DOC.renderUnorderedList(['Just now', '59 minutes ago', '12 hours ago', 'Today, 11:59 AM', 'Today, 12:00 PM', 'Yesterday', 'Feb 2, 2026'])}
      ${DOC.renderUnorderedList(['< 1 minute', '< 1 hour', '< 12 hours', '> 12 hours, AM', '> 12 hours, PM', '> 1 day', '> 2 days'])}
    </div>`);

    const attribution = `<section class="ig-doc__section ig-doc__section--plain">
      <p class="ig-doc__attribution">Written after referring to <a href="https://atlassian.design/content/writing-guidelines/date-and-time-guideline" target="_blank" rel="noopener noreferrer">Atlassian Design</a>↗ and <a href="https://m2.material.io/design/communication/data-formats.html" target="_blank" rel="noopener noreferrer">Material System</a>↗.</p>
    </section>`;

    return `<article class="ig-doc ig-data-formats" data-node-id="33305:168420">
      ${DOC.renderDocHero('Data formats')}
      ${topRow}
      <div class="ig-data-formats__split">${dateTime}${dateRanges}</div>
      ${pastFuture}
      ${common}
      ${attribution}
      ${DOC.renderDocFooter()}
    </article>`;
  }

  window.TMAInteractiveGuidanceDataFormats = { renderDataFormats };
})();
