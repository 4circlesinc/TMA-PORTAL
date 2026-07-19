@extends('sign.layout')
@section('title', 'Review '.$title)
@section('doc', $title)

@section('style')
  .rev-bar { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:12px 20px; background:#fff; border-bottom:1px solid var(--line); }
  .rev-bar__status { font-size:13px; color:var(--muted); }
  .rev-bar__status b { color:var(--ink); }
  .rev-wrap { max-width:920px; margin:0 auto; padding:20px; }
  .rev-doc { width:100%; height:70vh; min-height:420px; border:1px solid var(--line); border-radius:10px; background:#fff; }
  .rev-doc img { display:block; max-width:100%; margin:0 auto; }
  .rev-card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; margin-top:18px; }
  .rev-card h2 { font-size:15px; margin:0 0 6px; }
  .rev-comment { width:100%; min-height:96px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font:inherit; font-size:14px; resize:vertical; }
  .rev-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:14px; flex-wrap:wrap; }
  .btn--ok { background:var(--ok); }
  .rev-done { text-align:center; padding:36px 20px; }
  .rev-done h1 { margin:0 0 8px; }
  .err { color:var(--danger); font-size:13px; margin:8px 0 0; }
@endsection

@section('body')
  <div class="rev-bar">
    <div class="rev-bar__status">
      Review &amp; approval @if ($sender) · from <b>{{ $sender }}</b> @endif
    </div>
  </div>

  <div class="rev-wrap" data-review>
    @if ($message)
      <p class="msg">{{ $message }}</p>
    @endif

    @if ($isImage)
      <div class="rev-doc" style="height:auto;padding:12px;overflow:auto">
        <img src="/sign/{{ $token }}/document" alt="Document to review">
      </div>
    @else
      <iframe class="rev-doc" src="/sign/{{ $token }}/document" title="Document to review"></iframe>
    @endif

    <div class="rev-card">
      <h2>Your decision</h2>
      <p class="sub" style="margin:0 0 12px">Approve this document, or request changes and tell the sender what needs to change.</p>
      <textarea class="rev-comment" data-comment placeholder="Add a comment (required to request changes)"></textarea>
      <p class="err" data-error hidden></p>
      <div class="rev-actions">
        <button type="button" class="btn btn--ghost" data-request-changes>Request changes</button>
        <button type="button" class="btn btn--ok" data-approve>Approve</button>
      </div>
    </div>
  </div>

  <p class="foot">Reviewed securely via TM ANTOINE Advisory</p>

  <script>
    (function () {
      var TOKEN = @json($token);
      var wrap = document.querySelector('[data-review]');
      var commentEl = wrap.querySelector('[data-comment]');
      var errEl = wrap.querySelector('[data-error]');
      var approveBtn = wrap.querySelector('[data-approve]');
      var changesBtn = wrap.querySelector('[data-request-changes]');

      function post(path, body) {
        return fetch('/sign/' + encodeURIComponent(TOKEN) + path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(body),
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) { var e = new Error(data.message || 'Something went wrong. Please try again.'); e.status = res.status; throw e; }
            return data;
          });
        });
      }

      function fail(msg) { errEl.textContent = msg; errEl.hidden = false; approveBtn.disabled = false; changesBtn.disabled = false; }

      function done(heading, note) {
        wrap.innerHTML = '<div class="rev-done"><h1>' + heading + '</h1><p class="sub">' + note + '</p></div>';
      }

      approveBtn.addEventListener('click', function () {
        errEl.hidden = true;
        approveBtn.disabled = true; changesBtn.disabled = true;
        post('/approve', { comment: commentEl.value.trim() })
          .then(function () { done('Approved', 'Thank you — the sender has been notified of your approval.'); })
          .catch(function (e) { fail(e.message); });
      });

      changesBtn.addEventListener('click', function () {
        errEl.hidden = true;
        var comment = commentEl.value.trim();
        if (!comment) { fail('Please add a comment describing the changes you need.'); commentEl.focus(); return; }
        approveBtn.disabled = true; changesBtn.disabled = true;
        post('/request-changes', { comment: comment })
          .then(function () { done('Changes requested', 'Your feedback has been sent to the sender. They will revise and resend the document.'); })
          .catch(function (e) { fail(e.message); });
      });
    })();
  </script>
@endsection
