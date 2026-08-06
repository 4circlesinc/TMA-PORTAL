<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Confirm your email</h1>
  <p class="tma-auth__subtitle">This is where we'll send documents, updates and notifications.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__group">
    <label class="tma-auth__field tma-auth__field--icon-start">
      <img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="16" height="16" aria-hidden="true">
      <input class="tma-auth__input" type="email" aria-label="Email address" value="{{ $user->email }}" disabled>
    </label>
    <p class="tma-auth__hint">To change this, ask your contact at {{ \App\Support\Mail\Postcards::site() }}.</p>
  </div>

  <div class="tma-auth__group">
    <label class="tma-auth__check">
      <input type="checkbox" name="email_confirmed" value="1" required
             @checked(old('email_confirmed', $values['email_confirmed'] ?? false))>
      <span>Yes, this is the right email address.</span>
    </label>
    @include('onboarding.steps._error', ['field' => 'email_confirmed'])
  </div>

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
