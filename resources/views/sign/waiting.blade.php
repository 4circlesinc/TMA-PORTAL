@extends('sign.layout')
@section('title', 'Not your turn yet')

@section('body')
  <div class="wrap">
    <div class="card" style="max-width:460px;margin:40px auto 0;padding:28px;text-align:center">
      <h1>It isn't your turn yet</h1>
      <p class="sub">
        {{ $name ? $name.', this' : 'This' }} document needs to be signed in order, and someone before you hasn't
        signed <strong>{{ $title }}</strong> yet. We'll email you the moment it's your turn — this link will work then.
      </p>
    </div>
    <p class="foot">Signed securely via TM ANTOINE Advisory</p>
  </div>
@endsection
