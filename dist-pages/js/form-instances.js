/* TMA — Form instances board (Figma 32728:395248) */
(function () {
  'use strict';

  const IN = () => window.TMAInput;

  function board(w, h, html) {
    return `<div class="tma-form-instances-page__board-wrap"><div class="tma-form-instances-page__board" style="width:${w}px;height:${h}px">${html}</div></div>`;
  }

  function place(left, top, html, nodeId, w, h) {
    let style = `left:${left}px;top:${top}px`;
    if (w != null) style += `;width:${w}px`;
    if (h != null) style += `;height:${h}px`;
    return `<div class="tma-form-instances-page__item" style="${style}" data-node-id="${nodeId}">${html}</div>`;
  }

  function placeControl(left, top, html, nodeId, disabled) {
    const opacity = disabled ? ' tma-form-instances-page__control--disabled' : '';
    return `<div class="tma-form-instances-page__control${opacity}" style="left:${left}px;top:${top}px" data-node-id="${nodeId}">${html}</div>`;
  }

  function renderControls() {
    const I = IN();
    return [
      placeControl(100, 100, I.renderRadio({ selected: true }), '32728:395249'),
      placeControl(100, 142, I.renderRadio({ selected: true, state: 'hover' }), '32728:395250'),
      placeControl(100, 184, I.renderRadio({ selected: true, state: 'disabled' }), '33313:20491', true),
      placeControl(142, 100, I.renderRadio({ selected: false }), '32728:395252'),
      placeControl(142, 142, I.renderRadio({ selected: false, state: 'hover' }), '32728:395253'),
      placeControl(142, 184, I.renderRadio({ selected: false, state: 'disabled' }), '33313:20492', true),
      placeControl(184, 100, I.renderCheckbox({ checked: 'checked' }), '32728:395261'),
      placeControl(184, 142, I.renderCheckbox({ checked: 'checked', state: 'hover' }), '32728:395262'),
      placeControl(184, 184, I.renderCheckbox({ checked: 'checked', state: 'disabled' }), '33313:20495', true),
      placeControl(226, 100, I.renderCheckbox({ checked: 'unchecked' }), '32728:395255'),
      placeControl(226, 142, I.renderCheckbox({ checked: 'unchecked', state: 'hover' }), '32728:395256'),
      placeControl(226, 184, I.renderCheckbox({ checked: 'unchecked', state: 'disabled' }), '33313:20493', true),
      placeControl(268, 100, I.renderCheckbox({ checked: 'indeterminate' }), '32728:395258'),
      placeControl(268, 142, I.renderCheckbox({ checked: 'indeterminate', state: 'hover' }), '32728:395259'),
      placeControl(268, 184, I.renderCheckbox({ checked: 'indeterminate', state: 'disabled' }), '33313:20494', true),
      placeControl(310, 100, I.renderSwitch({ on: true }), '32728:395264'),
      placeControl(310, 142, I.renderSwitch({ on: true, state: 'hover' }), '32728:395265'),
      placeControl(310, 184, I.renderSwitch({ on: true, state: 'disabled' }), '33313:20496', true),
      placeControl(352, 100, I.renderSwitch({ on: false }), '32728:395267'),
      placeControl(352, 142, I.renderSwitch({ on: false, state: 'hover' }), '32728:395268'),
      placeControl(352, 184, I.renderSwitch({ on: false, state: 'disabled' }), '33313:20497', true),
    ].join('');
  }

  function renderInputs() {
    const I = IN();
    return [
      place(404, 100, I.renderFormPlaceholder1Row({ nodeId: '32728:395270', placeholder: 'First Name' }), '32728:395270', 175, 56),
      place(589, 100, I.renderFormPlaceholder1Row({ nodeId: '32728:395271', placeholder: 'Last Name' }), '32728:395271', 175, 56),
      place(404, 166, I.renderFormTitleValue({ nodeId: '32728:395272', title: 'Email', placeholder: 'Please enter your email address.' }), '32728:395272', 360, 88),
      place(404, 264, I.renderFormDateField({ nodeId: '32728:395273', title: 'Date', placeholder: 'February 24th, 2026 at 8:53 PM.' }), '32728:395273', 360, 88),
      place(404, 362, I.renderFormSelectValue({ nodeId: '32728:395274', title: 'Model', value: 'GPT-4' }), '32728:395274', 360, 88),
      place(404, 460, I.renderFormSelectValue({ nodeId: '32728:395275', title: 'Enabled Plugins', value: 'Design-GPT' }), '32728:395275', 360, 88),
      place(404, 558, I.renderFormCommandInput({ nodeId: '32728:395276' }), '32728:395276', 360, 96),
      place(774, 100, I.renderFormTitleValue({ nodeId: '32728:395277', title: 'Manage Budget', value: '$36000.00' }), '32728:395277', 360, 88),
      place(774, 198, I.renderFormCheckboxGroup({ nodeId: '32728:395278', title: 'Overuse Notifications', glass: true, items: [{ label: 'Email', checked: true }, { label: 'Phone', checked: false }] }), '32728:395278', 360, 88),
      place(774, 296, I.renderFormSwitchField({ nodeId: '32728:395279', title: 'Allow Changes', text: 'Allowed', on: true }), '32728:395279', 360, 88),
      place(774, 394, I.renderFormDateField({ nodeId: '32728:395280', title: 'Due Date', value: 'Feb 1, 2026', valueBlack: true, glass: true }), '32728:395280', 360, 88),
      place(774, 492, I.renderFormCheckboxGroup({ nodeId: '32728:395281', title: 'Overuse Notifications', glass: true, items: [{ label: 'Email', checked: true }, { label: 'Phone', checked: false }] }), '32728:395281', 360, 88),
      place(774, 590, I.renderFormSwitchField({ nodeId: '32728:395282', title: 'Status', text: 'Active', on: true }), '32728:395282', 360, 88),
      place(1144, 100, I.renderFormTitleValue({ nodeId: '32728:395283', title: 'Contact Phone', value: '+852 19850622' }), '32728:395283', 360, 88),
      place(1144, 198, I.renderFormTitleValue({ nodeId: '32728:395285', title: 'Company', value: 'TMA' }), '32728:395285', 360, 88),
      place(1144, 296, I.renderFormSelectValue({ nodeId: '32728:395287', title: 'Country', value: 'United States' }), '32728:395287', 360, 88),
      place(1144, 394, I.renderFormSwitchField({ nodeId: '32728:395288', title: 'Status', text: 'Active', on: true }), '32728:395288', 360, 88),
      place(1144, 492, I.renderFormTagInput({ nodeId: '32728:395284', title: 'Title', tags: ['List Item', 'Tag'] }), '32728:395284', 360, 88),
      place(1144, 590, I.renderFormTitleValue({ nodeId: '32728:395286', title: 'Company Site', value: 'tma-portal' }), '32728:395286', 360, 88),
    ].join('');
  }

  function renderInstancesBoard() {
    return board(1604, 782, renderControls() + renderInputs());
  }

  function mountInstances(container) {
    if (!container || !IN()) return;
    container.innerHTML = renderInstancesBoard();
    if (typeof IN().mountInteractive === 'function') {
      IN().mountInteractive(container);
    }
  }

  window.TMAFormInstances = { mountInstances, renderInstancesBoard };
})();
