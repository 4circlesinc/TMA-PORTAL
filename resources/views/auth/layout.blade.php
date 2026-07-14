<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>@yield('title') — TM ANTOINE Advisory</title>
  <link rel="icon" href="/images/brand/tma/favicon.png">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="/css/auth.css">
  <link rel="stylesheet" href="/css/auth-flow.css">
  <script>(function(){try{var m=localStorage.getItem("tma.themeMode")||"",t=localStorage.getItem("tma.theme")||"",d=m?m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches):t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();</script>
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
