package com.tmantoinelaw.portal.web

/** The two pages the desktop shell shows when the portal cannot be reached (desktop/main.js showOffline, showLoadError), verbatim. */
object OfflinePages {
    fun offline(portalUrl: String): String = """
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font: 15px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1c1c1c;
             display: grid; place-content: center; justify-items: center; height: 100vh;
             margin: 0; text-align: center; gap: 10px; background: #fff; padding: 24px; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #9a9a9a; margin-bottom: 6px; }
      h1 { font-size: 17px; margin: 0; font-weight: 600; }
      p { margin: 0; color: #6b6b6b; max-width: 30rem; }
      button { font: inherit; padding: 8px 18px; border-radius: 8px; border: 1px solid #ddd;
               background: #1c1c1c; color: #fff; cursor: pointer; margin-top: 10px; }
      @media (prefers-color-scheme: dark) {
        body { background: #141414; color: #f2f2f2; } p { color: #9a9a9a; }
        button { background: #f2f2f2; color: #141414; border-color: #333; }
      }
    </style>
    <div class="dot"></div>
    <h1>You're offline</h1>
    <p>The portal will open again on its own as soon as you have a connection.
       Anything you changed on this device is saved and will be sent then.</p>
    <button onclick="location.href='$portalUrl'">Try now</button>
    <script>
      addEventListener('online', () => { location.href = '$portalUrl'; });
      setInterval(() => { if (navigator.onLine) location.href = '$portalUrl'; }, 5000);
    </script>
    """.trimIndent()

    fun loadError(portalUrl: String, description: String, url: String): String = """
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font: 15px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1c1c1c;
             display: grid; place-content: center; height: 100vh; margin: 0;
             text-align: center; gap: 12px; background: #fff; }
      h1 { font-size: 17px; margin: 0; }
      p { margin: 0; color: #6b6b6b; max-width: 34rem; }
      code { font-size: 13px; color: #999; }
      button { font: inherit; padding: 8px 18px; border-radius: 8px; border: 1px solid #ddd;
               background: #1c1c1c; color: #fff; cursor: pointer; margin-top: 8px; }
      @media (prefers-color-scheme: dark) {
        body { background: #141414; color: #f2f2f2; } p { color: #9a9a9a; }
        button { background: #f2f2f2; color: #141414; border-color: #333; }
      }
    </style>
    <h1>Can't reach the portal</h1>
    <p>${description.replace("<", "&lt;")}</p>
    <code>${url.replace("<", "&lt;")}</code>
    <button onclick="location.href='$portalUrl'">Try again</button>
    """.trimIndent()
}
