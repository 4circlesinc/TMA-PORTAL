<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>@yield('title') | TM ANTOINE Advisory</title>
  <link rel="icon" href="/images/brand/tma/favicon.png">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="/css/auth.css">
  <link rel="stylesheet" href="/css/auth-flow.css">
  <!-- Light unless the reader explicitly chose Dark. Dark mode is unfinished, so the device colour scheme is ignored on purpose, see FOLLOW_SYSTEM_THEME in public/js/dashboard.js. -->
  <script>(function(){try{if((localStorage.getItem("tma.themeMode")||"")==="dark")document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();</script>
  {{-- in <head> and render-blocking on purpose: its observer has to be live while the
       body parses, or the stage art paints black for a frame before it swaps --}}
  <script src="/js/illustration-theme.js?v=1"></script>
  <style>
    html, body { margin: 0; min-height: 100%; }
  </style>
</head>
<body>
  @yield('body')

  <script src="/js/auth-flow.js"></script>
  @stack('scripts')
</body>
</html>
