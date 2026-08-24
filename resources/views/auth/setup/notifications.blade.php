@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Notifications</h1>
    <p class="tma-auth__subtitle">Choose how you want to hear about activity. You can fine-tune every category later in Settings.</p>
  </div>

  <form method="POST" action="{{ route('account-setup.store', ['step' => 'notifications']) }}" class="tma-auth__setup-form">
    @csrf

    <div class="tma-auth__setup-notify-list">
      @foreach ($groups as $key => $label)
        @php $group = $prefs[$key] ?? ['portal' => true, 'desktop' => false]; @endphp
        <div class="tma-auth__setup-notify-row">
          <span class="tma-auth__setup-notify-name">{{ $label }}</span>
          <label class="tma-auth__setup-toggle">
            <input type="hidden" name="{{ $key }}[portal]" value="0">
            <input type="checkbox" name="{{ $key }}[portal]" value="1" {{ ($group['portal'] ?? true) ? 'checked' : '' }} {{ in_array($key, $nonSilenceable, true) ? 'disabled checked' : '' }}>
            <span>In portal</span>
          </label>
          <label class="tma-auth__setup-toggle">
            <input type="hidden" name="{{ $key }}[desktop]" value="0">
            <input type="checkbox" name="{{ $key }}[desktop]" value="1" {{ ($group['desktop'] ?? false) ? 'checked' : '' }}>
            <span>Desktop</span>
          </label>
        </div>
      @endforeach
    </div>

    <p class="tma-auth__setup-hint">Email notifications for each category stay on by default. Turn them off anytime under Settings → Notifications.</p>

    <button type="submit" class="tma-auth__submit">Continue</button>
  </form>
@endsection
