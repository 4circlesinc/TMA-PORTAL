@extends('request.layout')
@section('title', $request->title)
@section('content')
@php
  use App\Support\Files\Presenter;

  // The rules, one line. Three bullets read as a form's small print; one
  // quiet line under the drop zone reads as a caption to it.
  $documents = $documents ?? [];
  $rules = array_values(array_filter([
      $allowedLabel ? ucfirst($allowedLabel).' only' : null,
      'Up to '.Presenter::humanSize($maxBytes).' per file',
      $documents !== []
          ? 'One file for each document'
          : ($multiple
              ? $remaining.' '.\Illuminate\Support\Str::plural('file', $remaining).' can still be added'
              : 'One file'),
  ]));
@endphp
<section class="tma-auth__card" aria-labelledby="request-title">
  <div class="tma-request__brand">
    <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Advisory">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="request-title">{{ $request->title }}</h1>
    <p class="tma-auth__subtitle">
      Requested by {{ $requester }}@if($request->expires_at) · Upload by {{ $request->expires_at->format('j M Y') }}@endif
    </p>
  </div>

  @if($request->message)
    <p class="tma-request__note">{{ $request->message }}</p>
  @endif

  <div class="tma-auth__form">
    <div data-banner></div>

    {{-- Who it was sent to is already known: the page does not ask again. --}}
    @if(!empty($knownSender))
      <input type="hidden" data-uploader-name value="{{ $request->recipient_name }}">
      <input type="hidden" data-uploader-email value="{{ $request->recipient_email }}">
    @else
      <label class="tma-auth__field">
        <input class="tma-auth__input" type="text" data-uploader-name value="{{ $request->recipient_name }}" placeholder="Your name" aria-label="Your name" autocomplete="name">
      </label>
      <label class="tma-auth__field">
        <input class="tma-auth__input" type="email" data-uploader-email value="{{ $request->recipient_email }}" placeholder="Your email (optional)" aria-label="Your email (optional)" autocomplete="email">
      </label>
    @endif

    @if($documents !== [])
      {{-- One row per document asked for, each with its own upload. --}}
      <ul class="tma-request__queue tma-request__docs" data-docs>
        @foreach($documents as $doc)
          <li class="tma-request__row tma-request__doc" data-doc="{{ $doc['id'] }}">
            <span class="tma-request__name">
              <span class="tma-request__doc-label">{{ $doc['label'] }}</span>
              @if($doc['person'])<span class="tma-auth__hint">{{ $doc['person'] }}</span>@endif
              @if(!empty($doc['help']))<span class="tma-auth__hint">{{ $doc['help'] }}</span>@endif
            </span>
            @if($doc['received'])
              <span class="tma-request__state is-done">Received</span>
            @else
              <button type="button" class="tma-auth__link-btn" data-doc-pick aria-label="Upload {{ $doc['label'] }}">Upload</button>
              <span class="tma-request__state" data-doc-state hidden></span>
              <input type="file" data-doc-input hidden @if($accept) accept="{{ $accept }}" @endif>
            @endif
          </li>
        @endforeach
      </ul>
      <p class="tma-auth__hint tma-request__rules">{{ implode(' · ', $rules) }}</p>
    @else
      <div class="tma-request__drop" data-drop tabindex="0" role="button" aria-label="Choose files to upload">
        <img src="/images/icons/phosphor/CloudArrowUp.svg" alt="" width="32" height="32" aria-hidden="true">
        <p class="tma-request__drop-title">Drop {{ $multiple ? 'files' : 'a file' }} here</p>
        <p class="tma-auth__hint">or click to browse your device</p>
      </div>
      <p class="tma-auth__hint tma-request__rules">{{ implode(' · ', $rules) }}</p>
      <input type="file" data-picker hidden @if($multiple) multiple @endif @if($accept) accept="{{ $accept }}" @endif>
      <ul class="tma-request__queue" data-queue></ul>
    @endif
  </div>
</section>

<script>
(function () {
  'use strict';

  /*
   * One file per request, in sequence.
   *
   * A single multipart post carrying ten files fails as one thing: the visitor
   * is told "upload failed" with no idea which of the ten arrived and which
   * did not, and retrying re-sends the ones that already landed. Sent one at a
   * time, every row on the list carries its own outcome and a retry only sends
   * what is missing.
   */
  var TOKEN = @json($token);
  var MAX_BYTES = @json($maxBytes);
  var MAX_SIZE_LABEL = @json(Presenter::humanSize($maxBytes));
  var ALLOWED = @json($allowed);
  var ALLOWED_LABEL = @json($allowedLabel);
  var MULTIPLE = @json($multiple);
  var CSRF = @json(csrf_token());

  var remaining = @json($remaining);

  var drop = document.querySelector('[data-drop]');
  var picker = document.querySelector('[data-picker]');
  var queue = document.querySelector('[data-queue]');
  var bannerHost = document.querySelector('[data-banner]');
  var busy = false;

  /* The same alert the sign-in pages draw, so "it worked" and "it did not"
     look the way they do everywhere else in the firm's pages. */
  function banner(kind, text) {
    bannerHost.innerHTML = '';
    if (!text) return;
    var ok = kind === 'ok';
    var el = document.createElement('div');
    el.className = 'tma-auth__alert tma-auth__alert--' + (ok ? 'success' : 'error');
    el.setAttribute('role', ok ? 'status' : 'alert');
    var icon = document.createElement('img');
    icon.src = '/images/icons/phosphor/' + (ok ? 'CheckCircle' : 'WarningCircle') + '.svg';
    icon.alt = '';
    icon.width = 16;
    icon.height = 16;
    icon.setAttribute('aria-hidden', 'true');
    var copy = document.createElement('span');
    copy.textContent = text;
    el.appendChild(icon);
    el.appendChild(copy);
    bannerHost.appendChild(el);
  }

  function extensionOf(name) {
    var m = /\.([A-Za-z0-9]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  /* The same three checks the server makes, so an obvious problem is named
     before the bytes go over the wire rather than after. The server still
     re-checks every one of them. */
  function localReason(file) {
    if (ALLOWED && ALLOWED.length && ALLOWED.indexOf(extensionOf(file.name)) === -1) {
      return ALLOWED_LABEL ? (ALLOWED_LABEL.charAt(0).toUpperCase() + ALLOWED_LABEL.slice(1)) + ' only' : 'File type not accepted';
    }
    if (file.size > MAX_BYTES) return 'Larger than ' + MAX_SIZE_LABEL;
    if (remaining <= 0) return 'No more files can be added';
    return null;
  }

  function addRow(file) {
    var li = document.createElement('li');
    li.className = 'tma-request__row';
    var name = document.createElement('span');
    name.className = 'tma-request__name';
    name.textContent = file.name;
    var state = document.createElement('span');
    state.className = 'tma-request__state';
    state.textContent = 'Waiting';
    li.appendChild(name);
    li.appendChild(state);
    queue.appendChild(li);
    return state;
  }

  function send(file, state, documentId) {
    var body = new FormData();
    body.append('file', file);
    if (documentId) body.append('document', documentId);
    body.append('name', (document.querySelector('[data-uploader-name]').value || '').trim());
    body.append('email', (document.querySelector('[data-uploader-email]').value || '').trim());

    state.textContent = 'Uploading…';
    state.className = 'tma-request__state';

    return fetch('/r/' + encodeURIComponent(TOKEN) + '/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-TOKEN': CSRF, 'X-Requested-With': 'XMLHttpRequest' },
      body: body,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        if (!r.ok) throw new Error(json.message || 'Upload failed. Please try again.');
        return json;
      });
    }).then(function (json) {
      state.textContent = 'Uploaded';
      state.className = 'tma-request__state is-done';
      if (typeof json.remaining === 'number') remaining = json.remaining;
    }).catch(function (err) {
      state.textContent = 'Failed';
      state.className = 'tma-request__state is-error';
      state.title = err.message;
      banner('err', err.message);
    });
  }

  function accept(files) {
    if (busy || !files || !files.length) return;
    var list = Array.prototype.slice.call(files);
    if (!MULTIPLE) list = list.slice(0, 1);

    banner('', '');
    busy = true;

    var chain = Promise.resolve();
    var sent = 0;

    list.forEach(function (file) {
      var state = addRow(file);
      var reason = localReason(file);
      if (reason) {
        state.textContent = reason;
        state.className = 'tma-request__state is-error';
        return;
      }
      chain = chain.then(function () {
        return send(file, state).then(function () { sent++; });
      });
    });

    chain.then(function () {
      busy = false;
      picker.value = '';
      if (sent > 0) {
        banner('ok', sent === 1
          ? 'Your file was sent to ' + @json($requester) + '. Thank you.'
          : sent + ' files were sent to ' + @json($requester) + '. Thank you.');
      }
    });
  }

  /*
   * A request for named documents: each row uploads its own file, which the
   * firm files under that document's name.
   */
  var docs = document.querySelector('[data-docs]');
  if (docs) {
    var refreshDone = function () {
      if (!docs.querySelectorAll('[data-doc-pick]').length) {
        banner('ok', 'Every document was received. Thank you.');
      }
    };
    docs.querySelectorAll('[data-doc]').forEach(function (row) {
      var pick = row.querySelector('[data-doc-pick]');
      var input = row.querySelector('[data-doc-input]');
      var state = row.querySelector('[data-doc-state]');
      if (!pick || !input || !state) return;
      pick.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        var reason = localReason(file);
        state.hidden = false;
        if (reason) {
          state.textContent = reason;
          state.className = 'tma-request__state is-error';
          return;
        }
        pick.disabled = true;
        send(file, state, row.getAttribute('data-doc')).then(function () {
          if (state.className.indexOf('is-done') !== -1) {
            state.textContent = 'Received';
            pick.remove();
            banner('ok', 'Thank you. ' + file.name + ' was received.');
            refreshDone();
          } else {
            pick.disabled = false;
          }
        });
      });
    });
    return;
  }

  drop.addEventListener('click', function () { picker.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
  });
  picker.addEventListener('change', function () { accept(picker.files); });

  ['dragenter', 'dragover'].forEach(function (type) {
    drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) {
    accept(e.dataTransfer && e.dataTransfer.files);
  });

  // A page-wide drop would otherwise be handled by the browser, which
  // navigates away from the form and loses everything typed into it.
  ['dragover', 'drop'].forEach(function (type) {
    window.addEventListener(type, function (e) { e.preventDefault(); });
  });
})();
</script>
@endsection
