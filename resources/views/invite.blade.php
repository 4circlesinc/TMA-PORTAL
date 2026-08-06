{{--
  The screen an emailed invitation link opens. One view, one `$state`:

    register      — no account for this address yet; create one
    registration-closed — no account yet, and the firm creates them itself
    signin        — the address already has a login; sign in to accept
    wrong-account — signed in as somebody else
    accept        — signed in as the invited person; confirm
    expired / accepted / cancelled / invalid / declined — dead ends, each said plainly

  Styling is lifted unchanged from the previous client-invite screen so the
  page still matches the portal's auth screens.
--}}
@php
  $dead = in_array($state, ['expired', 'accepted', 'cancelled', 'invalid', 'declined', 'registration-closed'], true);
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ $dead ? 'Invitation' : 'Your invitation' }} · {{ $organisation }}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --blue: #03a5e9; --ink: #0f1115; --muted: rgba(0,0,0,.5); --line: #e6e8ec; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: #f9f9fa; }
    .card { width: 100%; max-width: 440px; background: #fff; border-radius: 28px; padding: 40px; }
    .mark { display: block; width: 64px; height: 64px; margin: 0 auto 20px; }
    h1 { margin: 0 0 6px; text-align: center; font-size: 24px; font-weight: 600; }
    .lead { margin: 0 0 24px; text-align: center; font-size: 14px; color: var(--muted); }
    label { display: block; font-size: 13px; font-weight: 600; margin: 0 0 6px; }
    .field { margin: 0 0 16px; }
    input { width: 100%; padding: 12px 14px; font: inherit; font-size: 15px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
    input:disabled { background: #f4f5f7; color: var(--muted); }
    input:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px rgba(3,165,233,.15); }
    .btn { display: block; width: 100%; margin-top: 8px; padding: 14px; font: inherit; font-size: 16px; font-weight: 600;
      color: #fff; background: #000; border: 0; border-radius: 16px; cursor: pointer; text-align: center; text-decoration: none; }
    .btn:hover { opacity: .92; }
    .btn--ghost { margin-top: 10px; color: var(--ink); background: transparent; border: 1px solid var(--line); }
    .err { margin: 0 0 16px; padding: 10px 14px; border-radius: 12px; background: #fdecec; color: #c0392b; font-size: 13px; }
    .foot { margin: 20px 0 0; text-align: center; font-size: 12px; color: var(--muted); }
    .foot a { color: var(--blue); text-decoration: none; }
    /* The "what you're being offered" summary — Phase 2 asks the screen to
       show the inviter, the organization and the access on offer. */
    .summary { margin: 0 0 20px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 16px; background: #fafbfc; }
    .summary dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
    .summary dt { color: var(--muted); }
    .summary dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .terms { display: flex; gap: 10px; align-items: flex-start; margin: 4px 0 18px; font-size: 12px; color: var(--muted); }
    .terms input { width: auto; margin-top: 2px; flex: none; }
    .terms a { color: var(--blue); text-decoration: none; }
    .note { margin: 0 0 20px; text-align: center; font-size: 14px; line-height: 20px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="card">
    <img class="mark" src="{{ url('/images/brand/tma/tma-logo-mark.png') }}" alt="{{ $organisation }}">

    @if ($errors->any())
      <div class="err">{{ $errors->first() }}</div>
    @endif

    {{-- ---------------------------------------------------- dead ends --}}
    @if ($state === 'expired')
      <h1>This invitation has expired</h1>
      <p class="note">This invitation has expired. Please request a new invitation.</p>
      <a class="btn" href="mailto:support@tmantoine.com?subject={{ rawurlencode('New portal invitation request') }}">Request a new invitation</a>
      <a class="btn btn--ghost" href="{{ url('/auth/login') }}">Go to sign in</a>

    @elseif ($state === 'accepted')
      <h1>This invitation has already been accepted</h1>
      <p class="note">Your account is already set up. Sign in to carry on where you left off.</p>
      <a class="btn" href="{{ url('/auth/login') }}">Sign in</a>

    @elseif ($state === 'cancelled')
      <h1>This invitation was withdrawn</h1>
      <p class="note">This invitation is no longer available. Contact us if you think that's a mistake.</p>
      <a class="btn" href="mailto:support@tmantoine.com">Contact support</a>

    @elseif ($state === 'declined')
      <h1>Invitation declined</h1>
      <p class="note">Thanks for letting us know — we won't set up an account.</p>

    @elseif ($state === 'invalid')
      <h1>This invitation link isn't valid</h1>
      <p class="note">The link may be incomplete, or it may have been replaced by a newer invitation. Please request a new one.</p>
      <a class="btn" href="mailto:support@tmantoine.com?subject={{ rawurlencode('New portal invitation request') }}">Request a new invitation</a>
      <a class="btn btn--ghost" href="{{ url('/auth/login') }}">Go to sign in</a>

    {{-- The firm has switched self-registration off in Client hub access, so
         the account has to be created for them. Deliberately vague about why:
         the visitor cannot act on the firm's settings. --}}
    @elseif ($state === 'registration-closed')
      <h1>We'll finish setting up your account</h1>
      <p class="note">{{ $organisation }} creates portal accounts for its clients. We'll be in touch with your sign-in details shortly.</p>
      <a class="btn" href="mailto:support@tmantoine.com?subject={{ rawurlencode('Portal account setup') }}">Contact support</a>
      <a class="btn btn--ghost" href="{{ url('/auth/login') }}">Go to sign in</a>

    {{-- --------------------------------------------- create an account --}}
    @elseif ($state === 'register')
      <h1>Create your account</h1>
      <p class="lead">{{ $inviter ? $inviter.' invited you to '.$organisation.'.' : 'You have been invited to '.$organisation.'.' }}</p>

      @include('partials.invite-summary')

      <form method="POST" action="{{ url('/invite/'.$token) }}">
        @csrf
        <div class="field">
          <label>Name</label>
          <input type="text" value="{{ $name }}" disabled>
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" value="{{ $email }}" disabled>
        </div>
        <div class="field">
          <label for="password">Choose a password</label>
          <input id="password" type="password" name="password" required minlength="8" autocomplete="new-password">
        </div>
        <div class="field">
          <label for="password_confirmation">Confirm password</label>
          <input id="password_confirmation" type="password" name="password_confirmation" required minlength="8" autocomplete="new-password">
        </div>
        <label class="terms">
          <input type="checkbox" name="terms" value="1" required>
          <span>I agree to the <a href="{{ url('/terms-of-service') }}">Terms</a> and
            <a href="{{ url('/privacy-policy') }}">Privacy Policy</a>.</span>
        </label>
        <button class="btn" type="submit">Create account &amp; sign in</button>
      </form>

    {{-- ------------------------------------- already has an account --}}
    @elseif ($state === 'signin')
      <h1>Accept your invitation</h1>
      <p class="lead">{{ $email }} already has an account here.</p>

      @include('partials.invite-summary')

      <p class="note">Sign in and we'll add this to the account you already have — nothing new is created.</p>
      <form method="POST" action="{{ url('/invite/'.$token.'/signin') }}">
        @csrf
        <button class="btn" type="submit">Sign in to accept</button>
      </form>

    @elseif ($state === 'wrong-account')
      <h1>You're signed in as someone else</h1>
      <p class="lead">This invitation is for {{ $email }}.</p>
      <p class="note">Sign out and sign back in as {{ $email }} to accept it.</p>
      <form method="POST" action="{{ url('/logout') }}">
        @csrf
        <button class="btn" type="submit">Sign out</button>
      </form>

    {{-- ---------------------------------------- signed in, confirm --}}
    @elseif ($state === 'accept')
      <h1>Accept your invitation</h1>
      <p class="lead">{{ $inviter ? $inviter.' invited you.' : 'You have been invited.' }}</p>

      @include('partials.invite-summary')

      <form method="POST" action="{{ url('/invite/'.$token.'/accept') }}">
        @csrf
        <button class="btn" type="submit">Accept invitation</button>
      </form>
      <form method="POST" action="{{ url('/invite/'.$token.'/decline') }}">
        @csrf
        <button class="btn btn--ghost" type="submit">Decline</button>
      </form>
    @endif

    @unless ($dead)
      <p class="foot">
        @if ($expiresAt)
          This invitation expires on {{ $expiresAt->format('j M Y') }}.<br>
        @endif
        Not expecting this? <a href="mailto:support@tmantoine.com">Contact support</a>.
      </p>
    @endunless
  </div>
</body>
</html>
