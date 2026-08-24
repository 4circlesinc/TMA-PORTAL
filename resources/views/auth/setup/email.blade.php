@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__icon" aria-hidden="true">
    <img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="80" height="80">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Email</h1>
    <p class="tma-auth__subtitle">Connect Outlook mail and choose how your inbox looks in the portal.</p>
  </div>

  @include('auth.setup._progress')

  @if (session('social_error'))
    <div class="tma-auth__alert tma-auth__alert--error" role="alert">
      <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
      <span>{{ session('social_error') }}</span>
    </div>
  @endif

  @if (session('status') === 'social-connected')
    <div class="tma-auth__alert tma-auth__alert--success" role="status">
      <img src="/images/icons/phosphor/CheckCircle.svg" alt="" width="16" height="16" aria-hidden="true">
      <span>Microsoft connected. Syncing continues in the background.</span>
    </div>
  @endif

  <div class="tma-auth__checklist">
    @if ($microsoft)
      <div class="tma-auth__task tma-auth__task--done">
        <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16"></span>
        <span class="tma-auth__task-copy">
          <span class="tma-auth__task-name">Microsoft connected</span>
          <span class="tma-auth__task-desc">{{ $microsoft->email }}</span>
        </span>
        <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
      </div>
    @else
      <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'microsoft', 'sync_all' => 1, 'return' => 'account-setup-email']) }}">
        <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Outlook.svg" alt="" width="16" height="16"></span>
        <span class="tma-auth__task-copy">
          <span class="tma-auth__task-name">Connect Microsoft Outlook</span>
          <span class="tma-auth__task-desc">Mail syncs into the portal — we do not connect Gmail for email.</span>
        </span>
        <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--recommended">Required</span></span>
      </a>
    @endif
  </div>

  <form class="tma-auth__form" method="POST" action="{{ route('account-setup.store', ['step' => 'email']) }}">
    @csrf

    <div class="tma-auth__pref-stack">
      <div class="tma-auth__pref-group">
        <p class="tma-auth__section-label">Inbox layout</p>
        <p class="tma-auth__section-hint">Split keeps your list and message side by side. List shows one pane at a time.</p>
        <div class="tma-auth__pref-mail-options tma-auth__pref-mail-options--two" role="radiogroup" aria-label="Inbox layout">
          @foreach (['split' => 'Split view', 'single' => 'List view'] as $value => $label)
            <label class="tma-auth__pref-mail-option">
              <input class="tma-auth__pref-input" type="radio" name="layout" value="{{ $value }}" {{ ($mail['layout'] ?? 'split') === $value ? 'checked' : '' }}>
              <span class="tma-auth__pref-mail-preview tma-auth__pref-mail-preview--{{ $value }}" aria-hidden="true"></span>
              <span class="tma-auth__pref-theme-label">{{ $label }}</span>
            </label>
          @endforeach
        </div>
      </div>

      <hr class="tma-auth__pref-divider" aria-hidden="true">

      <div class="tma-auth__pref-group">
        <p class="tma-auth__section-label">Email sidebar</p>
        <p class="tma-auth__section-hint">The left rail holds folders and labels inside Email.</p>
        <div class="tma-auth__pref-mail-options tma-auth__pref-mail-options--three" role="radiogroup" aria-label="Email sidebar">
          @foreach (['full' => ['Full labels', 'Folder names visible'], 'icons' => ['Icons only', 'Compact rail'], 'hidden' => ['Hidden', 'Max reading space']] as $value => [$label, $desc])
            <label class="tma-auth__pref-mail-option tma-auth__pref-mail-option--tall">
              <input class="tma-auth__pref-input" type="radio" name="sidebarMode" value="{{ $value }}" {{ ($mail['sidebarMode'] ?? 'full') === $value ? 'checked' : '' }}>
              <span class="tma-auth__pref-mail-preview tma-auth__pref-mail-sidebar-preview tma-auth__pref-mail-sidebar-preview--{{ $value }}" aria-hidden="true"></span>
              <span class="tma-auth__pref-sidebar-copy">
                <span class="tma-auth__pref-sidebar-label">{{ $label }}</span>
                <span class="tma-auth__pref-sidebar-desc">{{ $desc }}</span>
              </span>
            </label>
          @endforeach
        </div>
      </div>
    </div>

    <div class="tma-auth__nav-actions">
      <button type="submit" class="tma-auth__submit tma-auth__submit--continue" @if (! $microsoft) disabled @endif>
        {{ $microsoft ? 'Continue to portal' : 'Connect Microsoft to continue' }}
      </button>
    </div>
  </form>

  @include('auth.setup._back')
@endsection
