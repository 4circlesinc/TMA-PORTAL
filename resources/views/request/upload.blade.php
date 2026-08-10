@extends('request.layout')
@section('title', $request->title)
@section('content')
@php
  use App\Support\Files\Presenter;
@endphp
<div class="card">
  <div class="card__head">
    <p class="eyebrow">Document request</p>
    <h1 class="card__title">{{ $request->title }}</h1>
    <p class="card__from">
      From {{ $requester }}@if($request->expires_at) · Please upload by {{ $request->expires_at->format('j M Y') }}@endif
    </p>
  </div>
  <div class="card__body">
    @if($request->message)
      <p class="note">{{ $request->message }}</p>
    @endif

    <ul class="rules">
      @if($allowedLabel)
        <li>{{ ucfirst($allowedLabel) }} only</li>
      @endif
      <li>Up to {{ Presenter::humanSize($maxBytes) }} per file</li>
      @if($multiple)
        <li>{{ $remaining }} {{ \Illuminate\Support\Str::plural('file', $remaining) }} can still be added</li>
      @else
        <li>One file</li>
      @endif
    </ul>

    <div data-banner></div>

    <div class="row">
      <div class="field">
        <label for="uploader-name">Your name</label>
        <input type="text" id="uploader-name" data-uploader-name value="{{ $request->recipient_name }}" autocomplete="name">
      </div>
      <div class="field">
        <label for="uploader-email">Your email <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <input type="email" id="uploader-email" data-uploader-email value="{{ $request->recipient_email }}" autocomplete="email">
      </div>
    </div>

    <div class="drop" data-drop tabindex="0" role="button" aria-label="Choose files to upload">
      <p class="drop__title">Drop {{ $multiple ? 'files' : 'a file' }} here</p>
      <p class="drop__hint">or click to browse your device</p>
    </div>

    <input type="file" data-picker hidden @if($multiple) multiple @endif @if($accept) accept="{{ $accept }}" @endif>

    <ul class="queue" data-queue></ul>
  </div>
</div>

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

  function banner(kind, text) {
    bannerHost.innerHTML = '';
    if (!text) return;
    var el = document.createElement('div');
    el.className = 'banner banner--' + kind;
    el.textContent = text;
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
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = file.name;
    var state = document.createElement('span');
    state.className = 'state';
    state.textContent = 'Waiting';
    li.appendChild(name);
    li.appendChild(state);
    queue.appendChild(li);
    return state;
  }

  function send(file, state) {
    var body = new FormData();
    body.append('file', file);
    body.append('name', (document.querySelector('[data-uploader-name]').value || '').trim());
    body.append('email', (document.querySelector('[data-uploader-email]').value || '').trim());

    state.textContent = 'Uploading…';
    state.className = 'state';

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
      state.className = 'state is-done';
      if (typeof json.remaining === 'number') remaining = json.remaining;
    }).catch(function (err) {
      state.textContent = 'Failed';
      state.className = 'state is-error';
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
        state.className = 'state is-error';
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
