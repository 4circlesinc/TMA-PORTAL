@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Email</h1>
    <p class="tma-auth__subtitle">Connect Outlook mail and choose how your inbox looks in the portal.</p>
  </div>

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

  <form method="POST" action="{{ route('account-setup.store', ['step' => 'email']) }}" class="tma-auth__setup-form" data-setup-form="email">
    @csrf

    <div class="tma-auth__setup-group">
      <h2 class="tma-auth__setup-label">Inbox layout</h2>
      <p class="tma-auth__setup-hint">Split keeps your list and message side by side. List shows one pane at a time — better on smaller screens.</p>
      <div class="tma-auth__setup-options tma-auth__setup-options--two" role="radiogroup" aria-label="Inbox layout">
        @foreach (['split' => 'Split view', 'single' => 'List view'] as $value => $label)
          <label class="tma-auth__setup-option tma-auth__setup-option--tall">
            <input type="radio" name="layout" value="{{ $value }}" {{ ($mail['layout'] ?? 'split') === $value ? 'checked' : '' }}>
            <span class="tma-auth__setup-preview tma-auth__setup-preview--mail tma-auth__setup-preview--mail-{{ $value }}" aria-hidden="true"></span>
            <span class="tma-auth__setup-option-label">{{ $label }}</span>
          </label>
        @endforeach
      </div>
    </div>

    <div class="tma-auth__setup-group">
      <h2 class="tma-auth__setup-label">Email sidebar</h2>
      <p class="tma-auth__setup-hint">The left rail holds folders and labels inside Email.</p>
      <div class="tma-auth__setup-options tma-auth__setup-options--three" role="radiogroup" aria-label="Email sidebar">
        @foreach (['full' => ['Full labels', 'Folder names visible'], 'icons' => ['Icons only', 'Compact rail'], 'hidden' => ['Hidden', 'Max reading space']] as $value => [$label, $desc])
          <label class="tma-auth__setup-option tma-auth__setup-option--tall">
            <input type="radio" name="sidebarMode" value="{{ $value }}" {{ ($mail['sidebarMode'] ?? 'full') === $value ? 'checked' : '' }}>
            <span class="tma-auth__setup-preview tma-auth__setup-preview--mail-sidebar tma-auth__setup-preview--mail-sidebar-{{ $value }}" aria-hidden="true"></span>
            <span class="tma-auth__setup-option-copy">
              <span class="tma-auth__setup-option-label">{{ $label }}</span>
              <span class="tma-auth__setup-option-desc">{{ $desc }}</span>
            </span>
          </label>
        @endforeach
      </div>
    </div>

    <div class="tma-auth__setup-group">
      <h2 class="tma-auth__setup-label">Signature</h2>
      <p class="tma-auth__setup-hint">Optional — appended to messages you send from the portal.</p>
      <label class="tma-auth__field">
        <span class="tma-auth__field-label">Email signature</span>
        <textarea class="tma-auth__input tma-auth__input--area" name="signature" rows="4" placeholder="Kind regards,&#10;{{ $user->name }}">{{ old('signature', $mail['signature'] ?? '') }}</textarea>
      </label>
    </div>

    <button type="submit" class="tma-auth__submit" @if (! $microsoft) disabled @endif>{{ $microsoft ? 'Continue to portal' : 'Connect Microsoft to continue' }}</button>
  </form>
@endsection
