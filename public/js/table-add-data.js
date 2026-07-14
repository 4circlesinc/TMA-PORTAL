/**
 * TMA Table Add data - modal + staging behavior.
 *
 * Rules:
 * 1. Only the close (×) button dismisses the modal (no backdrop / Escape).
 * 2. Close (×) auto-saves entered data to a staged draft.
 * 3. Cancel clears the form without saving; modal stays open.
 * 4. Save stages data without closing.
 * 5. Clicking Add again commits the staged row to the table, then opens a fresh modal.
 */
(function () {
  'use strict';

  var DEFAULT_DATE = 'February 24th, 2026 at 8:53 PM.';

  function formatCreationDate() {
    var now = new Date();
    var months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    var month = months[now.getMonth()];
    var day = now.getDate();
    var suffix = 'th';
    if (day % 10 === 1 && day !== 11) suffix = 'st';
    else if (day % 10 === 2 && day !== 12) suffix = 'nd';
    else if (day % 10 === 3 && day !== 13) suffix = 'rd';

    var hours = now.getHours();
    var minutes = now.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    var minStr = minutes < 10 ? '0' + minutes : String(minutes);

    return month + ' ' + day + suffix + ', ' + now.getFullYear() + ' at ' + hours + ':' + minStr + ' ' + ampm + '.';
  }

  function fieldValue(el) {
    if (!el) return '';
    if ('value' in el) return String(el.value || '').trim();
    return String(el.textContent || '').trim();
  }

  function syncInputFields(modal) {
    modal.querySelectorAll('[data-field]').forEach(function (control) {
      var field = control.closest('.tma-input');
      if (!field) return;
      var hasValue = fieldValue(control).length > 0;
      field.classList.toggle('tma-input--has-value', hasValue);
      field.classList.toggle('tma-input--active', hasValue);
    });
  }

  function readFormDate(modal) {
    var dateWrap = modal.querySelector('[data-add-data-date]');
    if (dateWrap && dateWrap._datePickerApi) {
      return dateWrap._datePickerApi.getValue().display || DEFAULT_DATE;
    }
    return fieldValue(modal.querySelector('[data-field="date"]')) || DEFAULT_DATE;
  }

  function resetFormDate(modal) {
    var dateWrap = modal.querySelector('[data-add-data-date]');
    if (dateWrap && dateWrap._datePickerApi && dateWrap._datePickerApi.setToNow) {
      dateWrap._datePickerApi.setToNow();
      return;
    }
    var dateEl = modal.querySelector('[data-field="date"]');
    if (dateEl) {
      if ('value' in dateEl) dateEl.value = formatCreationDate();
      else dateEl.textContent = formatCreationDate();
    }
  }

  function fillFormDate(modal, dateText) {
    var dateWrap = modal.querySelector('[data-add-data-date]');
    if (dateWrap && dateWrap._datePickerApi && dateWrap._datePickerApi.setDisplay) {
      dateWrap._datePickerApi.setDisplay(dateText || formatCreationDate());
      return;
    }
    var dateEl = modal.querySelector('[data-field="date"]');
    if (dateEl) {
      var text = dateText || formatCreationDate();
      if ('value' in dateEl) dateEl.value = text;
      else dateEl.textContent = text;
    }
  }

  function readForm(modal) {
    var first = modal.querySelector('[data-field="firstName"]');
    var last = modal.querySelector('[data-field="lastName"]');
    var email = modal.querySelector('[data-field="email"]');
    var avatarBtn = modal.querySelector('[data-add-avatar]');
    var preview = modal.querySelector('[data-avatar-preview]');

    return {
      firstName: fieldValue(first),
      lastName: fieldValue(last),
      email: fieldValue(email),
      date: readFormDate(modal),
      avatarSrc: avatarBtn && avatarBtn.dataset.hasImage && preview ? preview.src : ''
    };
  }

  function hasContent(data) {
    return !!(data.firstName || data.lastName || data.email || data.avatarSrc);
  }

  function resetForm(modal) {
    var first = modal.querySelector('[data-field="firstName"]');
    var last = modal.querySelector('[data-field="lastName"]');
    var email = modal.querySelector('[data-field="email"]');
    var dateEl = modal.querySelector('[data-field="date"]');
    var avatarBtn = modal.querySelector('[data-add-avatar]');
    var preview = modal.querySelector('[data-avatar-preview]');
    var fileInput = modal.querySelector('[data-avatar-input]');

    if (first) first.value = '';
    if (last) last.value = '';
    if (email) email.value = '';
    resetFormDate(modal);
    if (avatarBtn) delete avatarBtn.dataset.hasImage;
    if (preview) {
      preview.src = '';
      preview.alt = '';
    }
    if (fileInput) fileInput.value = '';
    syncInputFields(modal);
  }

  function fillForm(modal, data) {
    var first = modal.querySelector('[data-field="firstName"]');
    var last = modal.querySelector('[data-field="lastName"]');
    var email = modal.querySelector('[data-field="email"]');
    var dateEl = modal.querySelector('[data-field="date"]');
    var avatarBtn = modal.querySelector('[data-add-avatar]');
    var preview = modal.querySelector('[data-avatar-preview]');

    if (first) first.value = data.firstName || '';
    if (last) last.value = data.lastName || '';
    if (email) email.value = data.email || '';
    fillFormDate(modal, data.date);
    if (data.avatarSrc && avatarBtn && preview) {
      preview.src = data.avatarSrc;
      preview.alt = 'Avatar';
      avatarBtn.dataset.hasImage = 'true';
    }
    syncInputFields(modal);
  }

  function showToast(message) {
    var toast = document.querySelector('[data-add-toast]');
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.visible = 'true';
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      delete toast.dataset.visible;
    }, 2200);
  }

  function stagedToRow(data, index) {
    var name = [data.firstName, data.lastName].filter(Boolean).join(' ') || 'New entry';
    return {
      orderId: '#CM98' + String(100 + index).slice(-2),
      user: name,
      avatarSrc: data.avatarSrc || '',
      avatar: 'AvatarMale06',
      project: data.email || '-',
      address: '-',
      date: data.date || formatCreationDate(),
      status: 'in-progress',
      statusLabel: 'In Progress'
    };
  }

  function insertRow(table, data) {
    var body = table.querySelector('[data-table-body]') || table.querySelector('.tma-table-a__body');
    if (!body) return;
    var rowData = stagedToRow(data, body.children.length + 1);
    var html;
    if (typeof window.TMATableAddDataRenderRow === 'function') {
      html = window.TMATableAddDataRenderRow(rowData, 0);
    } else {
      return;
    }
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    var row = wrapper.firstElementChild;
    if (row) {
      row.dataset.addedRow = 'true';
      body.insertBefore(row, body.firstChild);
    }
  }

  function wireFormControls(modal, handlers) {
    var avatarBtn = modal.querySelector('[data-add-avatar]');
    var fileInput = modal.querySelector('[data-avatar-input]');
    var preview = modal.querySelector('[data-avatar-preview]');
    var removeBtn = modal.querySelector('[data-avatar-remove]');

    modal.querySelectorAll('[data-add-close]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        handlers.onClose();
      });
    });

    modal.querySelectorAll('[data-add-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        handlers.onCancel();
      });
    });

    modal.querySelectorAll('[data-add-save]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        handlers.onSave();
      });
    });

    if (avatarBtn && fileInput) {
      avatarBtn.addEventListener('click', function () {
        fileInput.click();
      });

      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file || !preview) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          preview.src = ev.target.result;
          preview.alt = 'Avatar';
          avatarBtn.dataset.hasImage = 'true';
        };
        reader.readAsDataURL(file);
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (avatarBtn) delete avatarBtn.dataset.hasImage;
        if (preview) {
          preview.src = '';
          preview.alt = '';
        }
        if (fileInput) fileInput.value = '';
      });
    }

    var dateEl = modal.querySelector('[data-field="date"]:not([data-add-data-date])');
    if (dateEl && !fieldValue(dateEl)) {
      if ('value' in dateEl) dateEl.value = formatCreationDate();
      else dateEl.textContent = formatCreationDate();
      syncInputFields(modal);
    }
  }

  function initModal(root) {
    if (root.hasAttribute('data-add-data-page')) return;

    var overlay = root.querySelector('[data-add-overlay]');
    var modal = root.querySelector('[data-add-modal]');
    if (!overlay || !modal) return;

    var table = root.querySelector('[data-add-table]');
    var staged = null;

    function openModal() {
      overlay.dataset.open = 'true';
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (staged) {
        fillForm(modal, staged);
      } else {
        resetForm(modal);
      }
    }

    function closeModal() {
      delete overlay.dataset.open;
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    function stageCurrent() {
      var data = readForm(modal);
      if (hasContent(data)) {
        staged = data;
      }
    }

    root.querySelectorAll('[data-add-data-trigger]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (staged && table) {
          insertRow(table, staged);
          staged = null;
          resetForm(modal);
        }
        openModal();
      });
    });

    wireFormControls(modal, {
      onClose: function () {
        stageCurrent();
        closeModal();
      },
      onCancel: function () {
        resetForm(modal);
        showToast('Changes discarded');
      },
      onSave: function () {
        stageCurrent();
        showToast('Draft saved - close (×) to dismiss');
      },
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        e.stopPropagation();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.dataset.open) {
        e.preventDefault();
      }
    });

    root._addDataStaged = staged;
    root._addDataGetStaged = function () { return staged; };
    root._addDataSetStaged = function (value) { staged = value; };
    root._addDataCommitStaged = function () {
      if (staged && table) {
        insertRow(table, staged);
        staged = null;
        resetForm(modal);
        return true;
      }
      return false;
    };
  }

  function initPage(root, options) {
    options = options || {};
    var modal = root.querySelector('[data-add-modal]');
    if (!modal) return;

    var staged = null;

    function stageCurrent() {
      var data = readForm(modal);
      if (hasContent(data)) {
        staged = data;
      }
    }

    function restoreForm() {
      if (staged) fillForm(modal, staged);
      else resetForm(modal);
    }

    wireFormControls(modal, {
      onClose: function () {
        stageCurrent();
        if (typeof options.onClose === 'function') options.onClose();
      },
      onCancel: function () {
        resetForm(modal);
        showToast('Changes discarded');
      },
      onSave: function () {
        stageCurrent();
        showToast('Draft saved');
      },
    });

    modal.querySelectorAll('input[data-field]').forEach(function (input) {
      input.addEventListener('input', stageCurrent);
      input.addEventListener('blur', stageCurrent);
    });

    root._addDataStageFromForm = stageCurrent;

    root._addDataStaged = staged;
    root._addDataGetStaged = function () { return staged; };
    root._addDataSetStaged = function (value) {
      staged = value;
      restoreForm();
    };
    root._addDataCommitStaged = function () {
      if (!staged) return false;
      var dash = document.querySelector('.tma-dash');
      var source = dash && dash._addDataSourceNav ? dash._addDataSourceNav : 'users';
      if (source === 'users' && window.TMAUsers && window.TMAUsers.addRowFromForm) {
        window.TMAUsers.addRowFromForm(staged);
        staged = null;
        resetForm(modal);
        return true;
      }
      return false;
    };
    root._addDataOpenFresh = function () {
      restoreForm();
    };

    restoreForm();
  }

  function init() {
    document.querySelectorAll('[data-table-add-data]').forEach(function (root) {
      if (root.hasAttribute('data-add-data-page')) return;
      initModal(root);
    });
  }

  window.TMATableAddData = {
    initPage: initPage,
    getStagedRoot: function () {
      return document.querySelector('[data-add-data-page]');
    },
    commitStaged: function () {
      var root = window.TMATableAddData.getStagedRoot();
      return root && root._addDataCommitStaged ? root._addDataCommitStaged() : false;
    },
    openAddData: function (opts) {
      opts = opts || {};
      var navId = opts.navId || 'users';
      var root = window.TMATableAddData.getStagedRoot();
      if (root && root._addDataCommitStaged) root._addDataCommitStaged();
      if (window.TMADashboard && window.TMADashboard.navigate) {
        window.TMADashboard.navigate({
          navId: navId,
          view: 'add-data',
          title: 'New entry',
          crumb: 'Users / New',
        });
      }
      if (root && root._addDataOpenFresh) root._addDataOpenFresh();
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
