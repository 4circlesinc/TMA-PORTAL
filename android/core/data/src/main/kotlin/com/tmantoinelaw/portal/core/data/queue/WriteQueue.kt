package com.tmantoinelaw.portal.core.data.queue

import com.tmantoinelaw.portal.core.database.WriteIntentEntity
import com.tmantoinelaw.portal.core.database.WriteQueueDao
import com.tmantoinelaw.portal.core.network.NetworkState
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.api.PortalJson
import com.tmantoinelaw.portal.core.network.session.SessionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** One multipart field: a value, or a file kept on disk until the write lands. */
@Serializable
data class QueuedPart(val name: String, val value: String? = null, val path: String? = null, val filename: String? = null, val mime: String? = null)

/** What a caller hands the queue when the network refused delivery. */
data class WriteIntent(
    val kind: String,
    val label: String,
    val method: String,
    val url: String,
    val body: JsonElement? = null,
    val parts: List<QueuedPart> = emptyList(),
    val invalidate: List<String> = emptyList(),
)

data class QueueSummary(val online: Boolean = true, val waiting: Int = 0, val failed: Int = 0, val syncing: Boolean = false)

data class Applied(val kind: String, val label: String, val response: JsonElement?)

/**
 * The write queue (public/js/portal-queue.js, prompt §9.4). It always tries
 * the network first: a caller reaches for this only on a delivery failure.
 * Replay is oldest-first and stops at the first entry that cannot be
 * delivered; an entry the server refuses on its merits is parked as
 * `failed` and shown, never dropped. Entries are scoped to the account and
 * survive sign-out.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Singleton
class WriteQueue @Inject constructor(
    private val dao: WriteQueueDao,
    private val http: PortalHttp,
    private val state: SessionState,
    private val connectivity: NetworkState,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = Mutex()
    private var retryJob: Job? = null
    private var retryDelay = RETRY_MS
    private val syncing = MutableStateFlow(false)

    /** The account's entries, live, for the sync panel. */
    val entries: StateFlow<List<WriteIntentEntity>> = state.accountId.flatMapLatest { a -> if (a == null) flowOf(emptyList()) else dao.watch(a) }
        .stateIn(scope, kotlinx.coroutines.flow.SharingStarted.Eagerly, emptyList())

    val summary: StateFlow<QueueSummary> = combine(entries, syncing, connectivity.online, state.reachable) { list, busy, net, reach ->
        QueueSummary(online = net && reach, waiting = list.count { it.state != "failed" }, failed = list.count { it.state == "failed" }, syncing = busy)
    }.stateIn(scope, kotlinx.coroutines.flow.SharingStarted.Eagerly, QueueSummary())

    private val _applied = MutableSharedFlow<Applied>(extraBufferCapacity = 16)
    /** A queued write landed: refetch what it touched, and let the replica walk. */
    val applied: SharedFlow<Applied> = _applied.asSharedFlow()

    private val _synced = MutableSharedFlow<Int>(extraBufferCapacity = 4)
    /** How many landed in one run, for the toast ("Your offline change has been synced"). */
    val synced: SharedFlow<Int> = _synced.asSharedFlow()

    init {
        connectivity.online.filter { it }.onEach { flush() }.launchIn(scope)
        state.accountId.filter { it != null }.onEach { flush() }.launchIn(scope)
    }

    fun usable(): Boolean = state.accountId.value != null

    suspend fun add(intent: WriteIntent): Long {
        val account = state.accountId.value ?: throw IOException("no queue")
        val id = dao.insert(WriteIntentEntity(
            account = account, kind = intent.kind, label = intent.label, method = intent.method, url = intent.url,
            body = intent.body?.toString(), parts = intent.parts.takeIf { it.isNotEmpty() }?.let { PortalJson.encodeToString(ListSerializer(QueuedPart.serializer()), it) },
            invalidate = intent.invalidate.takeIf { it.isNotEmpty() }?.joinToString("\n"), at = System.currentTimeMillis(),
        ))
        schedule(0)
        return id
    }

    fun flush() { scope.launch { run() } }

    /** Try again a parked entry. */
    suspend fun retry(id: Long) {
        val e = dao.get(id) ?: return
        dao.update(e.copy(state = "waiting", error = ""))
        flush()
    }

    /** Discard a parked entry: the person decided, never the queue. */
    suspend fun discard(id: Long) {
        val e = dao.get(id) ?: return
        e.parts?.let { p -> runCatching { PortalJson.decodeFromString(ListSerializer(QueuedPart.serializer()), p) }.getOrNull()?.forEach { part -> part.path?.let { File(it).delete() } } }
        dao.delete(id)
    }

    /** Only the wait is cancellable; a replay already in flight always finishes its request. */
    private fun schedule(ms: Long) {
        retryJob?.cancel()
        retryJob = scope.launch { delay(ms); flush() }
    }

    private suspend fun run() {
        if (!running.tryLock()) return
        val account = state.accountId.value ?: run { running.unlock(); return }
        syncing.value = true
        var applied = 0
        var outcome = "done"
        try {
            // Keep draining until nothing waits: entries added while a run is going must not sit until the next wake.
            drain@ while (true) {
                val queue = dao.all(account).filter { it.state != "failed" }
                if (queue.isEmpty()) break
                for (entry in queue) {
                    when (send(entry)) {
                        "applied" -> applied++
                        "failed" -> Unit
                        else -> { outcome = "stop"; break@drain }
                    }
                }
            }
        } finally {
            syncing.value = false
            running.unlock()
        }
        if (outcome == "done") {
            retryDelay = RETRY_MS
        } else {
            schedule(retryDelay)
            retryDelay = minOf(retryDelay * 2, RETRY_MAX_MS)
        }
        if (applied > 0) _synced.tryEmit(applied)
    }

    /** applied | failed | stop (portal-queue.js send()). */
    private suspend fun send(entry: WriteIntentEntity): String {
        dao.update(entry.copy(tries = entry.tries + 1))
        val request = http.request(entry.url).method(entry.method, bodyFor(entry) ?: "{}".toRequestBody("application/json; charset=utf-8".toMediaType())).build()
        return try {
            val response = http.raw(request)
            response.use { r ->
                state.reachable.value = true
                when {
                    r.code == 401 || r.code == 419 -> "stop"
                    r.code == 429 || r.code >= 500 -> "stop"
                    !r.isSuccessful -> {
                        val json = runCatching { PortalJson.parseToJsonElement(r.body.string()).jsonObject }.getOrNull()
                        dao.update(entry.copy(state = "failed", error = messageFor(r.code, json)))
                        "failed"
                    }
                    else -> {
                        val json = runCatching { PortalJson.parseToJsonElement(r.body.string()) }.getOrNull()
                        dao.delete(entry.id)
                        entry.parts?.let { p -> runCatching { PortalJson.decodeFromString(ListSerializer(QueuedPart.serializer()), p) }.getOrNull()?.forEach { part -> part.path?.let { File(it).delete() } } }
                        _applied.tryEmit(Applied(entry.kind, entry.label, json))
                        "applied"
                    }
                }
            }
        } catch (e: IOException) {
            state.reachable.value = false
            "stop"
        }
    }

    private fun bodyFor(entry: WriteIntentEntity): okhttp3.RequestBody? {
        entry.parts?.let { raw ->
            val parts = runCatching { PortalJson.decodeFromString(ListSerializer(QueuedPart.serializer()), raw) }.getOrNull() ?: return null
            val b = MultipartBody.Builder().setType(MultipartBody.FORM)
            parts.forEach { p ->
                if (p.path != null) b.addFormDataPart(p.name, p.filename ?: "upload", File(p.path).asRequestBody((p.mime ?: "application/octet-stream").toMediaType()))
                else b.addFormDataPart(p.name, p.value.orEmpty())
            }
            return b.build()
        }
        return entry.body?.toRequestBody("application/json; charset=utf-8".toMediaType())
    }

    private fun messageFor(status: Int, json: JsonObject?): String {
        json?.get("message")?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }?.let { return it }
        return when (status) {
            422 -> "The server would not accept this change."
            403, 404 -> "You can no longer change this."
            else -> "This change could not be saved."
        }
    }

    private companion object {
        const val RETRY_MS = 15_000L
        const val RETRY_MAX_MS = 5 * 60_000L
    }
}

/**
 * Network first, then the queue (portal-queue.js "it always tries the
 * network first"): a rejected connection queues the intent and reports it;
 * a 4xx/5xx is an answer and is thrown to the caller.
 */
suspend fun <T> WriteQueue.deliverOrQueue(intent: WriteIntent, deliver: suspend () -> T): QueuedResult<T> = try {
    QueuedResult.Delivered(deliver())
} catch (e: IOException) {
    if (e is com.tmantoinelaw.portal.core.network.api.PortalException) throw e
    if (!usable()) throw e
    QueuedResult.Queued(add(intent))
}

sealed interface QueuedResult<out T> {
    data class Delivered<T>(val value: T) : QueuedResult<T>
    data class Queued(val id: Long) : QueuedResult<Nothing>
}
