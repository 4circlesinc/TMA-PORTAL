package com.tmantoinelaw.portal.core.network.realtime

import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.api.PortalException
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.api.PortalJson
import com.tmantoinelaw.portal.core.network.session.SessionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.IOException
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

/** Where the socket is, so screens can decide between live updates and their poll fallback. */
enum class RealtimeState { Disconnected, Connecting, Connected, Refused }

/** A frame from a subscribed channel: `event` is exactly `broadcastAs()`, no leading dot. */
data class RealtimeEvent(val channel: String, val event: String, val data: JsonElement) {
    val obj: JsonObject? get() = data as? JsonObject
    fun string(key: String): String? = obj?.get(key)?.jsonPrimitive?.content
    fun long(key: String): Long? = string(key)?.toLongOrNull()
}

/** What `/me.realtime` hands over (app/Support/RealtimeConfig.php). */
data class RealtimeEndpoint(val key: String, val host: String, val port: Int, val tls: Boolean)

/**
 * The one socket (prompt §10): Pusher protocol 7 over OkHttp against Reverb,
 * private-channel auth through `/broadcasting/auth` with the same cookie jar,
 * jittered backoff, a 90 s zombie rule, and re-auth of every channel on
 * reconnect. It never replays what was missed; consumers refetch on
 * `connected` transitions.
 */
@Singleton
class RealtimeClient @Inject constructor(
    private val okHttp: OkHttpClient,
    private val http: PortalHttp,
    private val config: PortalConfig,
    private val session: SessionState,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _state = MutableStateFlow(RealtimeState.Disconnected)
    val state: StateFlow<RealtimeState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()

    /** Fires on every Disconnected→Connected transition: refetch everything you show. */
    private val _connected = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val connected: SharedFlow<Unit> = _connected.asSharedFlow()

    private var endpoint: RealtimeEndpoint? = null
    private var socket: WebSocket? = null
    private var wanted = false
    private var foreground = true
    private var retries = 0
    private var reconnectJob: Job? = null
    private var healthJob: Job? = null
    private var backgroundJob: Job? = null
    private val lastFrameAt = AtomicLong(0)
    private val lock = Any()

    /** Channels the app wants, with whether the server has acknowledged them. */
    private val channels = LinkedHashMap<String, Boolean>()

    /** Called whenever `/me` answers. A changed key restarts the socket; `null` (disabled) closes it. */
    fun configure(endpoint: RealtimeEndpoint?) {
        val changed = endpoint != this.endpoint
        this.endpoint = endpoint
        if (endpoint == null) { wanted = false; close(); return }
        wanted = true
        if (changed || _state.value == RealtimeState.Disconnected || _state.value == RealtimeState.Refused) {
            retries = 0
            reconnect(now = true)
        }
    }

    fun setForeground(inFront: Boolean) {
        foreground = inFront
        backgroundJob?.cancel()
        if (inFront) {
            if (wanted && (socket == null || _state.value != RealtimeState.Connected)) reconnect(now = true)
        } else {
            // Grace period, then let go: background delivery is push (prompt §13), not a held socket.
            backgroundJob = scope.launch { delay(60_000); if (!foreground) close(keepWanted = true) }
        }
    }

    fun subscribe(channel: String) {
        val fresh = synchronized(lock) { if (channels.containsKey(channel)) false else { channels[channel] = false; true } }
        if (fresh && _state.value == RealtimeState.Connected) scope.launch { authoriseAndSubscribe(channel) }
    }

    fun unsubscribe(channel: String) {
        val had = synchronized(lock) { channels.remove(channel) != null }
        if (had) socket?.send(PusherFrame.unsubscribe(channel))
    }

    fun disconnect() { wanted = false; close() }

    private fun close(keepWanted: Boolean = false) {
        reconnectJob?.cancel(); healthJob?.cancel()
        socket?.close(1000, "bye"); socket = null
        session.socketId.value = null
        if (!keepWanted) wanted = false
        synchronized(lock) { channels.keys.forEach { channels[it] = false } }
        if (_state.value != RealtimeState.Refused) _state.value = RealtimeState.Disconnected
    }

    private fun url(e: RealtimeEndpoint): String {
        val scheme = if (e.tls) "wss" else "ws"
        return "$scheme://${config.realtimeHost(e.host)}:${e.port}/app/${e.key}?protocol=7&client=tma-portal&version=1.0&flash=false"
    }

    private fun reconnect(now: Boolean) {
        val e = endpoint ?: return
        if (!wanted || !foreground) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            if (!now) {
                val base = minOf(30_000.0, 1000.0 * Math.pow(2.0, retries.toDouble()))
                delay((base * (0.7 + Random.nextDouble() * 0.6)).toLong())
            }
            if (!isActive || !wanted) return@launch
            _state.value = RealtimeState.Connecting
            socket?.cancel()
            socket = okHttp.newWebSocket(Request.Builder().url(url(e)).build(), listener)
        }
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            retries = 0
            lastFrameAt.set(System.currentTimeMillis())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            lastFrameAt.set(System.currentTimeMillis())
            val frame = PusherFrame.parse(text) ?: return
            when (frame.event) {
                "pusher:connection_established" -> {
                    session.socketId.value = frame.string("socket_id")
                    _state.value = RealtimeState.Connected
                    startHealth()
                    scope.launch {
                        val wantedChannels = synchronized(lock) { channels.keys.toList() }
                        wantedChannels.forEach { authoriseAndSubscribe(it) }
                        _connected.tryEmit(Unit)
                    }
                }
                "pusher:ping" -> webSocket.send(PusherFrame.pong())
                "pusher:pong" -> Unit
                "pusher_internal:subscription_succeeded" -> frame.channel?.let { c -> synchronized(lock) { if (channels.containsKey(c)) channels[c] = true } }
                "pusher:error" -> {
                    val code = frame.string("code")?.toIntOrNull() ?: 0
                    when (code) {
                        in 4000..4099 -> { _state.value = RealtimeState.Refused; wanted = false; webSocket.close(1000, "refused") }
                        in 4200..4299 -> { webSocket.cancel(); reconnect(now = true) }
                        else -> { webSocket.cancel(); retries++; reconnect(now = false) }
                    }
                }
                else -> frame.channel?.let { _events.tryEmit(RealtimeEvent(it, frame.event, frame.data)) }
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (socket !== webSocket) return
            dropped()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (socket !== webSocket) return
            dropped()
        }
    }

    private fun dropped() {
        healthJob?.cancel()
        socket = null
        session.socketId.value = null
        synchronized(lock) { channels.keys.forEach { channels[it] = false } }
        if (_state.value == RealtimeState.Refused) return
        _state.value = RealtimeState.Disconnected
        if (wanted && foreground) { retries++; reconnect(now = false) }
    }

    /** 90 s without a frame is a zombie (messaging-realtime.js:32-34), checked every 30 s while up. */
    private fun startHealth() {
        healthJob?.cancel()
        healthJob = scope.launch {
            while (isActive) {
                delay(30_000)
                if (System.currentTimeMillis() - lastFrameAt.get() > 90_000) {
                    socket?.cancel()
                    dropped()
                    return@launch
                }
            }
        }
    }

    private suspend fun authoriseAndSubscribe(channel: String) {
        val socketId = session.socketId.value ?: return
        val ws = socket ?: return
        try {
            val body = buildJsonObject { put("socket_id", socketId); put("channel_name", channel) }
            val answer = http.post("/broadcasting/auth", body, JsonElement.serializer()).jsonObject
            val auth = answer["auth"]?.jsonPrimitive?.content
            val channelData = answer["channel_data"]?.jsonPrimitive?.content
            ws.send(PusherFrame.subscribe(channel, auth, channelData))
        } catch (e: PortalException) {
            // 403 = not allowed, or signed out; the session watchdog decides which. Drop the channel either way.
            synchronized(lock) { channels.remove(channel) }
        } catch (e: IOException) {
            // Offline mid-handshake: the reconnect re-runs every channel.
        }
    }
}
