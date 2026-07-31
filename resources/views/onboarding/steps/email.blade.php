<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Confirm your email</h1>
  <p class="tma-auth__subtitle">This is where we'll send documents, updates and notifications.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__field">
    <span class="tma-auth__section-label">Email address</span>
    <input class="tma-auth__input" type="email" value="{{ $user->email }}" disabled>
    <span class="tma-auth__hint">To change this, ask your contact at {{ \App\Support\Mail\Postcards::site() }}.</span>
  </div>
  <label class="tma-auth__check">
    <input type="checkbox" name="email_confirmed" value="1" required
           @checked(old('email_confirmed', $values['email_confirmed'] ?? false))>
    <span>Yes, this is the right email address.</span>
  </label>
  @error('email_confirmed')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
