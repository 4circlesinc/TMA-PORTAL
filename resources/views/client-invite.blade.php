<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Create your account · TM ANTOINE Advisory</title>
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
    .btn { width: 100%; margin-top: 8px; padding: 14px; font: inherit; font-size: 16px; font-weight: 600; color: #fff; background: #000; border: 0; border-radius: 16px; cursor: pointer; }
    .btn:hover { opacity: .92; }
    .err { margin: 0 0 16px; padding: 10px 14px; border-radius: 12px; background: #fdecec; color: #c0392b; font-size: 13px; }
    .foot { margin: 20px 0 0; text-align: center; font-size: 12px; color: var(--muted); }
    .foot a { color: var(--blue); text-decoration: none; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="{{ url('/client-invite/'.$invite->token) }}">
    @csrf
    <img class="mark" src="{{ url('/images/brand/tma/tma-logo-mark.png') }}" alt="TM ANTOINE Advisory">
    <h1>Create your account</h1>
    <p class="lead">Connect to your files with TM ANTOINE Advisory.</p>

    @if ($errors->any())
      <div class="err">{{ $errors->first() }}</div>
    @endif

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

    <button class="btn" type="submit">Create account &amp; sign in</button>
    <p class="foot">By creating an account you agree to our
      <a href="{{ url('/terms-of-service') }}">Terms</a> and
      <a href="{{ url('/privacy-policy') }}">Privacy Policy</a>.</p>
  </form>
</body>
</html>
