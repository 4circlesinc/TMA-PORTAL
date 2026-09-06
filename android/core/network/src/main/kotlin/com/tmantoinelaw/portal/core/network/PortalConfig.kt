package com.tmantoinelaw.portal.core.network

/**
 * Which portal this build talks to. Provided by the app module from BuildConfig
 * (debug: the Docker stack through the emulator's host alias; release: production).
 */
data class PortalConfig(
    /** `https://portal.tmantoinelaw.com` or `http://10.0.2.2:8001`, no trailing slash. */
    val origin: String,
    /**
     * The Docker stack reports its websocket host as `localhost` (REVERB_HOST in
     * .env.docker.example); the emulator reaches the host at 10.0.2.2. Debug only.
     */
    val rewriteLocalhost: Boolean,
    /** Must contain "Android" so Security settings labels the device (app/Support/DeviceName.php). */
    val userAgent: String,
) {
    fun url(path: String): String = origin + (if (path.startsWith("/")) path else "/$path")

    fun realtimeHost(host: String): String =
        if (rewriteLocalhost && (host == "localhost" || host == "127.0.0.1")) "10.0.2.2" else host
}
