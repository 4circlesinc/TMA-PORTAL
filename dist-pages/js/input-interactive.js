/* TMA — Interactive input behaviors */
(function () {
  'use strict';

  const svg = (key, cls, w, h) =>
    (window.TMAInputIcons && window.TMAInputIcons.svg(key, cls, w, h)) || '';

  function syncFieldState(field) {
    const control = field.querySelector('.tma-input__control, .tma-input__command-control, .tma-input__tag-entry');
    if (!control) return;
    const hasValue = control.tagName === 'SELECT'
      ? control.value !== ''
      : String(control.value || '').length > 0;
    field.classList.toggle('tma-input--has-value', hasValue);
    field.classList.toggle('tma-input--active', document.activeElement === control || hasValue);
  }

  function syncCounter(textarea) {
    const wrap = textarea.closest('.tma-input--textarea-counter');
    if (!wrap) return;
    const counter = wrap.querySelector('.tma-input__counter');
    if (!counter) return;
    const max = parseInt(counter.dataset.max || '200', 10);
    counter.textContent = `${textarea.value.length}/${max}`;
  }

  function toggleCheckbox(btn) {
    const checked = btn.getAttribute('aria-pressed') === 'true';
    const next = !checked;
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    btn.innerHTML = svg(
      next ? 'Checkbox20Checked' : 'Checkbox20Unchecked',
      'tma-input__form-check-svg',
      20,
      20,
    );
  }

  function toggleSwitch(btn) {
    const on = btn.getAttribute('aria-pressed') === 'true';
    const next = !on;
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    btn.innerHTML = svg(
      next ? 'Switch28On' : 'Switch28Off',
      'tma-input__form-switch-svg',
      28,
      28,
    );
  }

  function toggleControl(btn) {
    if (btn.classList.contains('tma-input__form-check')) {
      toggleCheckbox(btn);
      return;
    }
    if (btn.classList.contains('tma-input__form-switch')) {
      toggleSwitch(btn);
      return;
    }

    const kind = btn.dataset.control;
    if (kind === 'checkbox') {
      const state = btn.getAttribute('aria-checked');
      const next = state !== 'true';
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      btn.innerHTML = svg(next ? 'Checkbox32Checked' : 'Checkbox32', 'tma-forms-guidance-page__control-svg', 32, 32);
      return;
    }
    if (kind === 'radio') {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      btn.classList.toggle('tma-forms-guidance-page__control--selected', next);
      btn.innerHTML = svg(next ? 'Radio32Selected' : 'Radio32', 'tma-forms-guidance-page__control-svg', 32, 32);
      return;
    }
    if (kind === 'switch') {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      btn.innerHTML = svg(next ? 'Switch32On' : 'Switch32Off', 'tma-forms-guidance-page__control-svg', 32, 32);
    }
  }

  function addTag(row, value) {
    const text = value.trim();
    if (!text) return;
    const tag = document.createElement('span');
    tag.className = 'tma-input__tag';
    tag.innerHTML = `<span class="tma-input__tag-label">${text}</span><button type="button" class="tma-input__tag-close" aria-label="Remove tag">${svg('Close12', 'tma-input__tag-close-svg', 12, 12)}</button>`;
    const entry = row.querySelector('.tma-input__tag-entry');
    if (entry) row.insertBefore(tag, entry);
    else row.appendChild(tag);
  }

  function mountInteractive(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const fields = scope.querySelectorAll('.tma-input:not(.tma-input--guidance)');

    fields.forEach((field) => {
      if (field.dataset.tmaBound === '1') return;
      field.dataset.tmaBound = '1';

      field.querySelectorAll('.tma-input__control, .tma-input__command-control, .tma-input__tag-entry').forEach((control) => {
        syncFieldState(field);
        control.addEventListener('focus', () => {
          field.classList.add('tma-input--active');
        });
        control.addEventListener('blur', () => syncFieldState(field));
        control.addEventListener('input', () => {
          syncFieldState(field);
          if (control.tagName === 'TEXTAREA' && control.classList.contains('tma-input__control')) {
            syncCounter(control);
          }
        });
        control.addEventListener('change', () => syncFieldState(field));
        if (control.tagName === 'TEXTAREA' && control.classList.contains('tma-input__control')) {
          syncCounter(control);
        }
      });
    });

    scope.querySelectorAll('.tma-input__form-check, .tma-input__form-switch').forEach((btn) => {
      if (btn.dataset.tmaBound === '1') return;
      btn.dataset.tmaBound = '1';
      btn.addEventListener('click', () => toggleControl(btn));
    });

    scope.querySelectorAll('.tma-forms-guidance-page__control[data-control]').forEach((btn) => {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
      if (btn.dataset.tmaBound === '1') return;
      btn.dataset.tmaBound = '1';
      btn.addEventListener('click', () => toggleControl(btn));
    });

    scope.querySelectorAll('.tma-input__tag-row').forEach((row) => {
      const entry = row.querySelector('.tma-input__tag-entry');
      if (entry && entry.dataset.tmaBound !== '1') {
        entry.dataset.tmaBound = '1';
        entry.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addTag(row, entry.value);
            entry.value = '';
          }
        });
      }
    });

    scope.addEventListener('click', (event) => {
      const close = event.target.closest('.tma-input__tag-close');
      if (close) {
        event.preventDefault();
        close.closest('.tma-input__tag')?.remove();
      }
    });
  }

  if (window.TMAInput) {
    window.TMAInput.mountInteractive = mountInteractive;
  } else {
    window.TMAInput = { mountInteractive };
  }
})();
