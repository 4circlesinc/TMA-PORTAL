<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TM ANTOINE Portal for Android</title>
  @if ($downloadUrl)
  <meta http-equiv="refresh" content="2;url={{ $downloadUrl }}">
  @endif
  <style>
    body { font: 15px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1c1c1c; background: #fff;
           margin: 0; padding: 40px 24px; display: grid; justify-items: center; text-align: center; gap: 12px; }
    img.logo { width: 180px; height: auto; margin-bottom: 8px; }
    h1 { font-size: 20px; margin: 0; font-weight: 600; }
    p { margin: 0; color: #6b6b6b; max-width: 30rem; }
    ol { text-align: left; color: #1c1c1c; max-width: 30rem; padding-left: 20px; margin: 8px 0 0; }
    ol li { margin: 4px 0; }
    a.btn { font: inherit; padding: 10px 20px; border-radius: 999px; background: #1c1c1c; color: #fff; text-decoration: none; margin-top: 12px; display: inline-block; }
    small { color: #9a9a9a; }
    @media (prefers-color-scheme: dark) {
      body { background: #141414; color: #f2f2f2; } p { color: #9a9a9a; } ol { color: #f2f2f2; }
      a.btn { background: #f2f2f2; color: #141414; }
    }
  </style>
</head>
<body>
  <img class="logo" src="{{ asset('images/brand/tma/tma-logo-horizontal.png') }}" alt="TM ANTOINE Partners Advisory">
  @if ($release)
    <h1>Your download is starting</h1>
    <p>The TM ANTOINE Portal app for Android, version {{ $release['version'] }}. Needs Android {{ $minOs }} or later.</p>
    <ol>
      <li>Open the downloaded file from the notification or your Downloads.</li>
      <li>If Android asks, allow installs from this source.</li>
      <li>Open the app and sign in as usual.</li>
    </ol>
    <a class="btn" href="{{ $downloadUrl }}">Download again</a>
    <script>setTimeout(function () { location.href = @json($downloadUrl); }, 1500);</script>
  @else
    <h1>The Android app is not available yet</h1>
    <p>Check back soon, or use the portal in your browser.</p>
  @endif
  <small>&copy; {{ date('Y') }} TM ANTOINE Advisory</small>
</body>
</html>
