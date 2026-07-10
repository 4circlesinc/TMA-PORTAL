/**
 * TMA Dashboard — Add Data view
 * Input form instances + DatePicker (date-picker-form / form-instances).
 */
(function () {
  'use strict';

  function renderFields() {
    var I = window.TMAInput;
    if (!I) return '';

    return '<form class="tma-dash__add-data-fields" data-add-modal>' +
      '<div class="tma-dash__add-data-fields__row">' +
        I.renderFormPlaceholder1Row({
          nodeId: '32728:395270',
          placeholder: 'First Name',
          name: 'firstName',
          dataField: 'firstName',
        }) +
        I.renderFormPlaceholder1Row({
          nodeId: '32728:395271',
          placeholder: 'Last Name',
          name: 'lastName',
          dataField: 'lastName',
        }) +
      '</div>' +
      I.renderFormTitleValue({
        nodeId: '32728:395272',
        title: 'Email',
        placeholder: 'Please enter your email address.',
        name: 'email',
        dataField: 'email',
        type: 'email',
      }) +
      '<div class="tma-dash__add-data-date" data-add-data-date data-field="date"></div>' +
    '</form>';
  }

  function mountDatePicker(pageRoot, onChange) {
    var mountEl = pageRoot.querySelector('[data-add-data-date]');
    var DP = window.TMADatePicker;
    if (!mountEl || !DP || !DP.attachField) return null;

    return DP.attachField(mountEl, {
      type: 'date-and-time',
      name: 'date',
      label: 'Date',
      placeholder: 'Pick date and time',
      closeOnSelect: false,
      defaultNow: true,
      onChange: onChange,
    });
  }

  function mount(container) {
    if (!container || container.hasAttribute('data-add-data-mounted')) return;

    container.innerHTML =
      '<div class="tma-dash__add-data-inner" data-table-add-data data-add-data-page>' +
        renderFields() +
      '</div>';

    container.setAttribute('data-add-data-mounted', '');

    var pageRoot = container.querySelector('[data-table-add-data]');

    if (window.TMAInput && window.TMAInput.mountInteractive) {
      window.TMAInput.mountInteractive(container);
    }

    pageRoot._datePicker = mountDatePicker(pageRoot, function () {
      if (pageRoot._addDataStageFromForm) pageRoot._addDataStageFromForm();
    });

    if (window.TMATableAddData && window.TMATableAddData.initPage) {
      window.TMATableAddData.initPage(pageRoot);
    }
  }

  window.TMADashboardAddData = { mount: mount };
})();
