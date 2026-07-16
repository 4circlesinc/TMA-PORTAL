@extends('share.layout')
@section('title', $file->name)
@php
  $iconMap = ['image'=>'FileImage','pdf'=>'FilePdf','video'=>'FileVideo','audio'=>'FileAudio','word'=>'FileDoc','excel'=>'FileXls','powerpoint'=>'FilePpt','archive'=>'FileZip','text'=>'FileText'];
  $icon = $iconMap[$category] ?? 'File';
@endphp
@section('content')
<div class="card">
  <div class="card__head">
    <img class="ico" src="/images/icons/phosphor/{{ $icon }}.svg" alt="">
    <div>
      <div class="card__title">{{ $file->name }}</div>
      <div class="card__meta">{{ \App\Support\Files\Presenter::humanSize((int) $file->size) }} · Shared file</div>
    </div>
    @if($share->allow_download)
      <div style="margin-left:auto"><a class="btn" href="/s/{{ $token }}/download">Download</a></div>
    @endif
  </div>
  <div class="card__body">
    @if($previewable)
      <div class="preview">
        @if($category === 'image')
          <img src="/s/{{ $token }}/preview" alt="{{ $file->name }}">
        @elseif($category === 'pdf')
          <iframe src="/s/{{ $token }}/preview" title="{{ $file->name }}"></iframe>
        @elseif($category === 'video')
          <video src="/s/{{ $token }}/preview" controls></video>
        @elseif($category === 'audio')
          <audio src="/s/{{ $token }}/preview" controls style="width:100%"></audio>
        @else
          <div class="empty" style="color:#cbd5e1">Preview not available.</div>
        @endif
      </div>
    @else
      <div class="empty">No in-browser preview for this file type.@if($share->allow_download) Use the download button above.@endif</div>
    @endif
  </div>
</div>
@endsection
