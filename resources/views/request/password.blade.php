@extends('request.layout')
@section('title', 'Password required')
@section('content')
<div class="card" style="max-width:420px;margin:40px auto 0">
  <div class="card__body">
    <p class="eyebrow">Document request</p>
    <h1 style="font-size:18px;margin:0 0 6px">Password required</h1>
    <p style="color:var(--muted);font-size:14px;margin:0 0 16px">Enter the password you were given to open this upload link.</p>
    <form method="POST" action="/r/{{ $token }}/unlock">
      @csrf
      <input type="password" name="password" placeholder="Password" autofocus required autocomplete="off">
      @if($error)<div class="err">Incorrect password. Please try again.</div>@endif
      <button class="btn" style="margin-top:14px;width:100%" type="submit">Unlock</button>
    </form>
  </div>
</div>
@endsection
