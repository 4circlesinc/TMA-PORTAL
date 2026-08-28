{{--
  The chrome a stranger sees when they open an upload link.

  Deliberately its own layout rather than the portal shell: nobody here has an
  account, so loading the shell's fifty scripts to draw one drop zone would be
  slow, would fail half its requests, and would put the workspace's navigation
  in front of somebody who has no access to any of it.

  It is drawn from the sign-in pages' parts (tokens, the single card, its
  fields and button) rather than a palette of its own, so the page a client
  lands on from an email is the same firm they see once they have an account.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>@yield('title', 'Upload files') | TM ANTOINE Advisory</title>
  <link rel="icon" type="image/png" href="/images/brand/tma/favicon.png">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="/css/auth.css">
  <link rel="stylesheet" href="/css/auth-flow.css">
  <link rel="stylesheet" href="/css/request.css">
  <style>
    html, body { margin: 0; min-height: 100%; }
  </style>
</head>
<body>
  <main class="tma-auth">
    <div class="tma-auth__body">
      @yield('content')
    </div>

    <p class="tma-auth__copyright">
      Uploaded over an encrypted connection to TM ANTOINE Advisory.<br>
      This link only accepts files, it gives no access to anything else.
    </p>
  </main>

  <script src="/js/auth-flow.js"></script>
  @stack('scripts')
</body>
</html>
