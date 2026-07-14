<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Settings - TM ANTOINE Advisory</title>
  <link rel="icon" type="image/png" href="/images/brand/tma/favicon.png">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/tokens.css?v=2">
  <link rel="stylesheet" href="/css/theme.css?v=2">
  <link rel="stylesheet" href="/css/dashboard.css?v=9">
  <link rel="stylesheet" href="/css/auth.css">
  <link rel="stylesheet" href="/css/auth-flow.css">
  <script>(function(){try{var m=localStorage.getItem("tma.themeMode")||"",t=localStorage.getItem("tma.theme")||"",d=m?m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches):t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();</script>
  <style>
    html, body { margin: 0; height: 100%; }
    body { background: var(--color-white); }
    [data-theme="dark"] body { background: #1c1c1c; }
  </style>
</head>
@php
  $twoFactorPending = $user->two_factor_secret && ! $user->two_factor_confirmed_at;
  $twoFactorOn = $user->hasTwoFactorEnabled();
  $statusMessages = [
    'password-updated' => 'Your password has been updated.',
    'two-factor-authentication-enabled' => 'Scan the QR code below to finish setting up two-factor authentication.',
    'two-factor-authentication-confirmed' => 'Two-factor authentication is on. Save your recovery codes below.',
    'two-factor-authentication-disabled' => 'Two-factor authentication has been turned off.',
    'recovery-codes-generated' => 'New recovery codes generated. Your old codes no longer work.',
    'other-sessions-ended' => 'Every session except this one has ended.',
    'mfa-required' => 'Your administrator requires two-factor authentication. Set it up below.',
    'social-connected' => 'Sign-in method connected. You can now sign in with either method.',
    'social-disconnected' => 'Sign-in method disconnected.',
  ];
  $googleAccount = $user->connectedAccount('google');
  $microsoftAccount = $user->connectedAccount('microsoft');
  $status = session('status');
  $eventLabels = [
    'registered' => 'Account created',
    'email_verified' => 'Email verified',
    'login' => 'Signed in',
    'logout' => 'Signed out',
    'login_failed' => 'Failed sign-in attempt',
    'password_reset' => 'Password reset',
    'lockout' => 'Sign-in temporarily locked',
    'social_connected' => 'Sign-in method connected',
    'social_disconnected' => 'Sign-in method disconnected',
    'user_invited' => 'Invited to the portal',
    'account_approved' => 'Account approved',
    'account_suspended' => 'Account suspended',
    'account_reactivated' => 'Account reactivated',
    'account_updated' => 'Profile updated by admin',
    'password_reset_link_sent' => 'Password reset link sent',
    'password_generated' => 'Temporary password generated',
  ];
@endphp
<body>
  <div class="tma-dash" data-theme-scope>

    {{-- Sidebar --}}
    <aside class="tma-dash__sidebar" aria-label="Primary">
      <div class="tma-dash__sidebar-logo" aria-label="TM ANTOINE Advisory">
        <div class="tma-dash__logo-expanded">
          <img class="tma-dash__logo-horizontal" src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Advisory" loading="lazy">
        </div>
        <div class="tma-dash__logo-collapsed">
          <img class="tma-dash__logo-mark" src="/images/brand/tma/tma-logo-mark.png" alt="TM ANTOINE Advisory" width="40" height="40" loading="lazy">
        </div>
      </div>

      <div class="tma-dash__sidebar-nav">
        <div class="tma-dash__nav-section">
          <div class="tma-dash__group-label">Dashboards</div>
          <a class="tma-dash__nav-item" href="/">
            <span class="tma-dash__nav-caret tma-dash__nav-caret--hidden"></span>
            <img class="tma-dash__nav-icon" src="/images/icons/phosphor/House.svg" alt="">
            <span>Dashboard</span>
          </a>
          <a class="tma-dash__nav-item" href="/overview">
            <span class="tma-dash__nav-caret tma-dash__nav-caret--hidden"></span>
            <img class="tma-dash__nav-icon" src="/images/icons/phosphor/ChartPieSlice.svg" alt="">
            <span>Overview</span>
          </a>
        </div>

        <div class="tma-dash__nav-section">
          <div class="tma-dash__group-label">Account settings</div>
          <a class="tma-dash__nav-item" href="/settings">
            <span class="tma-dash__nav-caret tma-dash__nav-caret--hidden"></span>
            <img class="tma-dash__nav-icon" src="/images/icons/phosphor/GearSix.svg" alt="">
            <span>Settings</span>
          </a>
          <a class="tma-dash__nav-item tma-dash__nav-item--active" href="/security-settings" aria-current="page">
            <span class="tma-dash__nav-caret tma-dash__nav-caret--hidden"></span>
            <img class="tma-dash__nav-icon" src="/images/icons/phosphor/ShieldCheck.svg" alt="">
            <span>Security</span>
          </a>
        </div>
      </div>

      <div class="tma-dash__profile">
        <img class="tma-dash__profile-avatar" src="/images/avatars/AvatarByewind.png" alt="" width="24" height="24">
        <div class="tma-dash__profile-meta">
          <span class="tma-dash__profile-name">{{ $user->name }}</span>
          <span class="tma-dash__profile-email">{{ $user->email }}</span>
        </div>
        <button type="button" class="tma-dash__profile-action-btn" data-action="sign-out" aria-label="Sign out" title="Sign out"><img src="/images/icons/phosphor/SignOut.svg" alt="" width="16" height="16"></button>
      </div>
    </aside>

    {{-- Header --}}
    <header class="tma-dash__header">
      <div class="tma-dash__header-left">
        <nav class="tma-dash__breadcrumb" aria-label="Breadcrumb">
          <span class="tma-dash__crumb--current">Settings / Security</span>
        </nav>
      </div>
      <div class="tma-dash__header-center"></div>
      <div class="tma-dash__header-right">
        <div class="tma-dash__header-icons">
          <button type="button" class="tma-dash__icon-btn" data-action="toggle-theme" aria-label="Toggle theme"><img src="/images/icons/phosphor/Sun.svg" alt=""></button>
        </div>
      </div>
    </header>

    {{-- Main --}}
    <main class="tma-dash__main">
      <div class="tma-dash__main-head">
        <div class="tma-dash__main-head-left">
          <h1 class="tma-dash__page-title">Security</h1>
        </div>
      </div>

      <div class="tma-dash__view">
        <div class="tma-security">

          @if ($status && isset($statusMessages[$status]))
            <div class="tma-auth__alert {{ $status === 'mfa-required' ? 'tma-auth__alert--warning' : 'tma-auth__alert--success' }}" role="status" style="width: 100%; max-width: none;">
              <img src="/images/icons/phosphor/{{ $status === 'mfa-required' ? 'ShieldCheck' : 'CheckCircle' }}.svg" alt="" width="16" height="16" aria-hidden="true">
              <span>{{ $statusMessages[$status] }}</span>
            </div>
          @endif

          @if (session('social_error'))
            <div class="tma-auth__alert tma-auth__alert--error" role="alert" style="width: 100%; max-width: none;">
              <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
              <span>{{ session('social_error') }}</span>
            </div>
          @endif

          {{-- Password --}}
          <section class="tma-security__card" id="password" aria-labelledby="sec-password">
            <div class="tma-security__head">
              <h2 class="tma-security__title" id="sec-password"><img src="/images/icons/phosphor/Password.svg" alt="" aria-hidden="true">Password</h2>
              <button type="button" class="tma-auth__chip-btn" data-dialog-open="#change-password-dialog"><span>Change password</span></button>
            </div>
            <p class="tma-security__desc">At least 10 characters. Changing it signs out your other devices.</p>
          </section>

          {{-- Connected accounts (next phase) --}}
          <section class="tma-security__card" id="connected" aria-labelledby="sec-connected">
            <div class="tma-security__head">
              <h2 class="tma-security__title" id="sec-connected"><img src="/images/icons/phosphor/Plugs.svg" alt="" aria-hidden="true">Connected accounts</h2>
            </div>
            <div class="tma-security__row">
              <span class="tma-security__row-ico" aria-hidden="true"><img src="/images/icons/brands/Google16.svg" alt=""></span>
              <span class="tma-security__row-copy">
                <span class="tma-security__row-name">Google</span>
                @if ($googleAccount)
                  <span class="tma-security__row-sub tma-auth__provider-status tma-auth__provider-status--on">Connected as {{ $googleAccount->email }}</span>
                @else
                  <span class="tma-security__row-sub">Not connected</span>
                @endif
              </span>
              @if ($googleAccount)
                <form method="POST" action="{{ route('social.disconnect', 'google') }}">
                  @csrf
                  <button type="submit" class="tma-auth__chip-btn"><span>Disconnect</span></button>
                </form>
              @else
                <a class="tma-auth__chip-btn" href="{{ route('social.redirect', 'google') }}"><span>Connect</span></a>
              @endif
            </div>
            <div class="tma-security__row">
              <span class="tma-security__row-ico" aria-hidden="true"><img src="/images/icons/brands/Microsoft16.svg" alt=""></span>
              <span class="tma-security__row-copy">
                <span class="tma-security__row-name">Microsoft</span>
                @if ($microsoftAccount)
                  <span class="tma-security__row-sub tma-auth__provider-status tma-auth__provider-status--on">Connected as {{ $microsoftAccount->email }}</span>
                @else
                  <span class="tma-security__row-sub">Not connected</span>
                @endif
              </span>
              @if ($microsoftAccount)
                <form method="POST" action="{{ route('social.disconnect', 'microsoft') }}">
                  @csrf
                  <button type="submit" class="tma-auth__chip-btn"><span>Disconnect</span></button>
                </form>
              @else
                <a class="tma-auth__chip-btn" href="{{ route('social.redirect', 'microsoft') }}"><span>Connect</span></a>
              @endif
            </div>
          </section>

          {{-- Two-factor authentication --}}
          <section class="tma-security__card" id="two-factor" aria-labelledby="sec-tfa">
            <div class="tma-security__head">
              <h2 class="tma-security__title" id="sec-tfa"><img src="/images/icons/phosphor/ShieldCheck.svg" alt="" aria-hidden="true">Two-factor authentication</h2>
              @if ($twoFactorOn)
                <span class="tma-auth__badge tma-auth__badge--done">On</span>
              @elseif (! $twoFactorPending)
                <span class="tma-auth__badge">Off</span>
              @endif
            </div>

            @if ($errors->confirmTwoFactorAuthentication->any())
              <div class="tma-auth__alert tma-auth__alert--error" role="alert" style="width: 100%; max-width: none;">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
                <span>That code didn't match - enter the newest one.</span>
              </div>
            @endif

            @if (! $user->two_factor_secret)
              <p class="tma-security__desc">Sign in with your password plus a 6-digit code from Microsoft Authenticator, Google Authenticator, or any TOTP app.</p>
              <form method="POST" action="{{ url('/auth/user/two-factor-authentication') }}">
                @csrf
                <button type="submit" class="tma-auth__chip-btn"><span>Turn on</span></button>
              </form>

            @elseif ($twoFactorPending)
              <p class="tma-security__desc">Scan the QR code with your authenticator app, then enter the 6-digit code it shows.</p>
              <div class="tma-auth__qr" role="img" aria-label="QR code for authenticator setup">
                {!! $user->twoFactorQrCodeSvg() !!}
              </div>
              <div class="tma-auth__manual-key">
                <code>{{ implode(' ', str_split(decrypt($user->two_factor_secret), 4)) }}</code>
                <button type="button" class="tma-auth__chip-btn" data-copy data-copy-text="{{ decrypt($user->two_factor_secret) }}">
                  <img src="/images/icons/phosphor/Copy.svg" alt="" width="14" height="14" aria-hidden="true">
                  <span>Copy</span>
                </button>
              </div>
              <form method="POST" action="{{ url('/auth/user/confirmed-two-factor-authentication') }}" class="tma-auth__fields" style="max-width: 384px;" data-tfa-confirm>
                @csrf
                <input type="hidden" name="code" data-otp-value>
                <div class="tma-auth__otp tma-auth__otp--6" data-otp role="group" aria-label="6 digit confirmation code">
                  @for ($i = 1; $i <= 6; $i++)
                    <input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" @if($i === 1) autocomplete="one-time-code" @endif aria-label="Digit {{ $i }}">
                  @endfor
                </div>
                <button type="submit" class="tma-auth__submit">Confirm &amp; turn on</button>
              </form>
              <form method="POST" action="{{ url('/auth/user/two-factor-authentication') }}">
                @csrf
                @method('DELETE')
                <button type="submit" class="tma-auth__link-btn">Cancel setup</button>
              </form>

            @else
              <p class="tma-security__desc">On - your sign-in asks for a 6-digit code from your authenticator app.</p>

              @if ($showRecoveryCodes)
                <div class="tma-auth__alert tma-auth__alert--warning" role="alert" style="width: 100%; max-width: none;">
                  <img src="/images/icons/phosphor/Warning.svg" alt="" width="16" height="16" aria-hidden="true">
                  <span><strong>Store these somewhere safe.</strong> They won't be shown again.</span>
                </div>
                <ul class="tma-auth__codes">
                  @foreach ($user->recoveryCodes() as $code)
                    <li class="tma-auth__code">{{ $code }}</li>
                  @endforeach
                </ul>
                <div class="tma-auth__actions" style="justify-content: flex-start;">
                  <button type="button" class="tma-auth__chip-btn" data-copy data-copy-target=".tma-auth__code">
                    <img src="/images/icons/phosphor/Copy.svg" alt="" width="14" height="14" aria-hidden="true">
                    <span>Copy</span>
                  </button>
                  <button type="button" class="tma-auth__chip-btn" data-download-codes>
                    <img src="/images/icons/phosphor/DownloadSimple.svg" alt="" width="14" height="14" aria-hidden="true">
                    <span>Download</span>
                  </button>
                  <button type="button" class="tma-auth__chip-btn" data-print>
                    <img src="/images/icons/phosphor/Printer.svg" alt="" width="14" height="14" aria-hidden="true">
                    <span>Print</span>
                  </button>
                </div>
              @endif

              <div class="tma-security__row">
                <span class="tma-security__row-ico" aria-hidden="true"><img src="/images/icons/phosphor/Key.svg" alt=""></span>
                <span class="tma-security__row-copy">
                  <span class="tma-security__row-name">Recovery codes</span>
                  <span class="tma-security__row-sub">{{ count($user->recoveryCodes()) }} codes available</span>
                </span>
                <form method="POST" action="{{ url('/auth/user/two-factor-recovery-codes') }}">
                  @csrf
                  <button type="submit" class="tma-auth__chip-btn"><span>Regenerate</span></button>
                </form>
              </div>

              <div class="tma-security__row">
                <span class="tma-security__row-ico" aria-hidden="true"><img src="/images/icons/phosphor/ShieldSlash.svg" alt=""></span>
                <span class="tma-security__row-copy">
                  <span class="tma-security__row-name">Turn off two-factor authentication</span>
                  <span class="tma-security__row-sub">Your recovery codes will stop working too.</span>
                </span>
                <button type="button" class="tma-auth__chip-btn" data-dialog-open="#disable-tfa-dialog"><span>Turn off</span></button>
              </div>
            @endif
          </section>

          {{-- Active sessions --}}
          <section class="tma-security__card" id="sessions" aria-labelledby="sec-sessions">
            <div class="tma-security__head">
              <h2 class="tma-security__title" id="sec-sessions"><img src="/images/icons/phosphor/Devices.svg" alt="" aria-hidden="true">Active sessions</h2>
              <button type="button" class="tma-auth__chip-btn" data-dialog-open="#logout-others-dialog"><span>Sign out other devices</span></button>
            </div>
            @forelse ($sessions as $session)
              <div class="tma-security__row">
                <span class="tma-security__row-ico" aria-hidden="true"><img src="/images/icons/phosphor/Desktop.svg" alt=""></span>
                <span class="tma-security__row-copy">
                  <span class="tma-security__row-name">{{ $session->device }} @if($session->current) <span class="tma-auth__badge tma-auth__badge--recommended">This device</span> @endif</span>
                  <span class="tma-security__row-sub">{{ $session->ip }} &middot; active {{ $session->lastActive }}</span>
                </span>
              </div>
            @empty
              <p class="tma-security__desc">No active sessions.</p>
            @endforelse
          </section>

          {{-- Recent activity --}}
          <section class="tma-security__card" id="history" aria-labelledby="sec-history">
            <div class="tma-security__head">
              <h2 class="tma-security__title" id="sec-history"><img src="/images/icons/phosphor/ClockCounterClockwise.svg" alt="" aria-hidden="true">Recent activity</h2>
            </div>
            <div class="tma-security__table-wrap">
              <table class="tma-security__table">
                <thead>
                  <tr><th>Event</th><th>When</th><th>IP address</th></tr>
                </thead>
                <tbody>
                  @forelse ($events as $event)
                    <tr>
                      <td>{{ $eventLabels[$event->event] ?? $event->event }}</td>
                      <td>{{ $event->created_at->format('M j, Y g:i:s A') }} UTC<br><span class="tma-security__row-sub">{{ $event->created_at->diffForHumans() }}</span></td>
                      <td>{{ $event->ip }}</td>
                    </tr>
                  @empty
                    <tr><td colspan="3">No activity yet.</td></tr>
                  @endforelse
                </tbody>
              </table>
            </div>
          </section>

        </div>
      </div>
    </main>
  </div>

  {{-- Change password dialog --}}
  <div class="tma-auth__dialog" id="change-password-dialog" hidden>
    <div class="tma-auth__dialog-card" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <h3 class="tma-auth__dialog-title" id="change-password-title">Change password</h3>
      @if ($errors->updatePassword->any())
        <div class="tma-auth__alert tma-auth__alert--error" role="alert" style="width: 100%;">
          <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
          <span>{{ $errors->updatePassword->first() }}</span>
        </div>
      @endif
      <form method="POST" action="{{ route('user-password.update') }}" class="tma-auth__fields">
        @csrf
        @method('PUT')
        {{-- lets password managers pair the new password with the account --}}
        <input type="email" value="{{ $user->email }}" autocomplete="username" readonly tabindex="-1" aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);border:0;padding:0;">
        <label class="tma-auth__field tma-auth__field--password">
          <input class="tma-auth__input" type="password" name="current_password" placeholder="Current password" autocomplete="current-password" aria-label="Current password" required>
          <button type="button" class="tma-auth__toggle-pwd" data-toggle-password aria-label="Show password" aria-pressed="false">
            <img src="/images/icons/phosphor/EyeSlash.svg" alt="" width="16" height="16" aria-hidden="true">
          </button>
        </label>
        <label class="tma-auth__field tma-auth__field--password">
          <input class="tma-auth__input" type="password" name="password" placeholder="New password" autocomplete="new-password" aria-label="New password" data-password-meter required>
          <button type="button" class="tma-auth__toggle-pwd" data-toggle-password aria-label="Show password" aria-pressed="false">
            <img src="/images/icons/phosphor/EyeSlash.svg" alt="" width="16" height="16" aria-hidden="true">
          </button>
        </label>
        <div class="tma-auth__strength" aria-hidden="true">
          <span class="tma-auth__strength-seg"></span>
          <span class="tma-auth__strength-seg"></span>
          <span class="tma-auth__strength-seg"></span>
          <span class="tma-auth__strength-seg"></span>
        </div>
        <label class="tma-auth__field tma-auth__field--password">
          <input class="tma-auth__input" type="password" name="password_confirmation" placeholder="Confirm new password" autocomplete="new-password" aria-label="Confirm new password" data-password-confirm required>
          <button type="button" class="tma-auth__toggle-pwd" data-toggle-password aria-label="Show password" aria-pressed="false">
            <img src="/images/icons/phosphor/EyeSlash.svg" alt="" width="16" height="16" aria-hidden="true">
          </button>
        </label>
        <div class="tma-auth__dialog-actions">
          <button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>
          <button type="submit" class="tma-auth__submit">Update password</button>
        </div>
      </form>
    </div>
  </div>

  {{-- Disable 2FA dialog --}}
  <div class="tma-auth__dialog" id="disable-tfa-dialog" hidden>
    <div class="tma-auth__dialog-card" role="dialog" aria-modal="true" aria-labelledby="disable-tfa-title">
      <h3 class="tma-auth__dialog-title" id="disable-tfa-title">Turn off two-factor authentication?</h3>
      <p class="tma-auth__dialog-text">Your recovery codes will stop working too.</p>
      <div class="tma-auth__dialog-actions">
        <button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Keep it on</button>
        <form method="POST" action="{{ url('/auth/user/two-factor-authentication') }}">
          @csrf
          @method('DELETE')
          <button type="submit" class="tma-auth__submit tma-auth__submit--danger">Turn off</button>
        </form>
      </div>
    </div>
  </div>

  {{-- Sign out other devices dialog --}}
  <div class="tma-auth__dialog" id="logout-others-dialog" hidden>
    <div class="tma-auth__dialog-card" role="dialog" aria-modal="true" aria-labelledby="logout-others-title">
      <h3 class="tma-auth__dialog-title" id="logout-others-title">Sign out other devices?</h3>
      <p class="tma-auth__dialog-text">Every session except this one will end immediately.</p>
      @error('password')
        <div class="tma-auth__alert tma-auth__alert--error" role="alert" style="width: 100%;">
          <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
          <span>{{ $message }}</span>
        </div>
      @enderror
      <form method="POST" action="{{ route('security-settings.logout-others') }}" class="tma-auth__fields">
        @csrf
        <label class="tma-auth__field tma-auth__field--password">
          <input class="tma-auth__input" type="password" name="password" placeholder="Confirm your password" autocomplete="current-password" aria-label="Confirm your password" required>
        </label>
        <div class="tma-auth__dialog-actions">
          <button type="button" class="tma-auth__submit tma-auth__submit--ghost" data-dialog-close>Cancel</button>
          <button type="submit" class="tma-auth__submit tma-auth__submit--danger">Sign out others</button>
        </div>
      </form>
    </div>
  </div>

  <script src="/js/auth-flow.js"></script>
  <script src="/js/sign-out.js"></script>
  <script>
    (function () {
      var form = document.querySelector("[data-tfa-confirm]");
      if (form) {
        form.addEventListener("submit", function () {
          var digits = form.querySelectorAll(".tma-auth__otp-digit");
          var value = "";
          for (var i = 0; i < digits.length; i++) value += digits[i].value;
          form.querySelector("[data-otp-value]").value = value;
        });
      }
      @if ($errors->updatePassword->any())
        document.getElementById("change-password-dialog").hidden = false;
      @endif
      @error('password')
        document.getElementById("logout-others-dialog").hidden = false;
      @enderror
    })();
  </script>
</body>
</html>
