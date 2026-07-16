@extends('sign.layout')
@section('title', 'Sign '.$title)
@section('doc', $title)

@section('style')
  .sign-bar { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:12px 20px; background:#fff; border-bottom:1px solid var(--line); }
  .sign-bar__status { font-size:13px; color:var(--muted); }
  .sign-bar__status b { color:var(--ink); }
  .sign-bar__actions { display:flex; align-items:center; gap:8px; }
  .sign-doc { max-width:900px; margin:0 auto; padding:20px; }
  .sign-page { position:relative; margin:0 auto 18px; background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.08); overflow:hidden; }
  .sign-page canvas.page { display:block; width:100%; height:auto; }
  .sign-layer { position:absolute; inset:0; }
  .sign-field { position:absolute; display:flex; align-items:center; justify-content:center; border:1px dashed var(--brand); border-radius:4px; background:rgba(19,109,160,.10); cursor:pointer; font-size:11px; color:var(--brand); overflow:hidden; padding:0 2px; }
  .sign-field:hover { background:rgba(19,109,160,.18); }
  .sign-field.is-done { border-style:solid; background:rgba(15,123,63,.08); border-color:var(--ok); color:var(--ok); cursor:pointer; }
  .sign-field.is-required::after { content:'*'; color:var(--danger); margin-left:2px; }
  .sign-field img { max-width:100%; max-height:100%; object-fit:contain; }
  .sign-field__text { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--ink); font-size:12px; }
  .sign-field input[type=text] { width:100%; border:0; background:transparent; font:inherit; font-size:12px; color:var(--ink); outline:none; padding:0 2px; }
  .modal { position:fixed; inset:0; z-index:20; display:grid; place-items:center; background:rgba(15,17,21,.5); padding:16px; }
  .modal__card { width:100%; max-width:520px; background:#fff; border-radius:14px; padding:22px; }
  .modal__head { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
  .modal__title { font-size:16px; font-weight:700; }
  .tabs { display:flex; gap:4px; margin-bottom:14px; }
  .tab { flex:1; padding:8px; border:1px solid var(--line); background:#fff; border-radius:8px; font:inherit; font-size:13px; cursor:pointer; }
  .tab.is-active { border-color:var(--brand); color:var(--brand); font-weight:600; }
  .pad { width:100%; height:180px; border:1px dashed var(--line); border-radius:10px; background:#fff; touch-action:none; cursor:crosshair; display:block; }
  .typed { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font:inherit; }
  .typed-preview { height:90px; display:grid; place-items:center; border:1px dashed var(--line); border-radius:10px; margin-top:10px; font-size:34px; font-family:'Segoe Script','Brush Script MT',cursive; }
  .modal__foot { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:16px; }
  .err { color:var(--danger); font-size:13px; margin:8px 0 0; }
  .drop { border:1px dashed var(--line); border-radius:10px; padding:20px; text-align:center; color:var(--muted); font-size:13px; }
@endsection

@section('body')
  <div class="sign-bar">
    <div class="sign-bar__status">
      <span data-progress>Loading…</span>
      @if ($sender) · from <b>{{ $sender }}</b> @endif
    </div>
    <div class="sign-bar__actions">
      <button type="button" class="btn--link" data-decline>Decline to sign</button>
      <button type="button" class="btn" data-finish disabled>Finish</button>
    </div>
  </div>

  <div class="sign-doc">
    @if ($message)
      <p class="msg">{{ $message }}</p>
    @endif
    <div data-pages>
      <p class="sub" style="text-align:center;padding:40px 0">Loading document…</p>
    </div>
  </div>

  <p class="foot">Signed securely via TM ANTOINE Advisory</p>

  <script>
    window.__SIGN = {
      token: @json($token),
      fields: @json($fields),
      isImage: @json($isImage),
      recipient: @json(['name' => $recipient->name, 'email' => $recipient->email]),
    };
  </script>
  <script src="/js/sign.js"></script>
@endsection
