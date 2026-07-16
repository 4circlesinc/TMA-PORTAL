@extends('sign.layout')
@section('title', 'Link unavailable')

@section('body')
  <div class="wrap">
    <div class="card" style="max-width:460px;margin:40px auto 0;padding:28px;text-align:center">
      <h1>{{ $heading }}</h1>
      <p class="sub">{{ $detail }}</p>
    </div>
    <p class="foot">Signed securely via TM ANTOINE Advisory</p>
  </div>
@endsection
