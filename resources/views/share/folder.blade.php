@extends('share.layout')
@section('title', $folder->name)
@section('content')
<div class="card">
  <div class="card__head">
    <img class="ico" src="/images/icons/phosphor/FolderFilled.svg" alt="">
    <div>
      <div class="card__title">{{ $folder->name }}</div>
      <div class="card__meta">{{ $folders->count() }} {{ \Illuminate\Support\Str::plural('folder', $folders->count()) }} · {{ $files->count() }} {{ \Illuminate\Support\Str::plural('file', $files->count()) }}</div>
    </div>
    @if($share->allow_download)
      <div style="margin-left:auto"><a class="btn" href="/s/{{ $token }}/download">Download all (ZIP)</a></div>
    @endif
  </div>
  <div class="card__body">
    @if($folders->isEmpty() && $files->isEmpty())
      <div class="empty">This folder is empty.</div>
    @else
      <ul class="list">
        @foreach($folders as $sub)
          <li>
            <img src="/images/icons/phosphor/FolderFilled.svg" width="20" height="20" alt="">
            <span class="name">{{ $sub->name }}</span>
          </li>
        @endforeach
        @foreach($files as $f)
          <li>
            <img src="/images/icons/phosphor/File.svg" width="20" height="20" alt="">
            <span class="name">{{ $f->name }}</span>
            <span style="margin-left:auto;color:var(--muted);font-size:13px">{{ \App\Support\Files\Presenter::humanSize((int) $f->size) }}</span>
            @if($share->allow_download)<a href="/s/{{ $token }}/file/{{ $f->uuid }}">Download</a>@endif
          </li>
        @endforeach
      </ul>
      @if($folders->isNotEmpty())
        <p style="color:var(--muted);font-size:12px;margin-top:16px">Subfolders and their contents are included in the ZIP download.</p>
      @endif
    @endif
  </div>
</div>
@endsection
