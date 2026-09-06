package com.tmantoinelaw.portal.core.data.files

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.tmantoinelaw.portal.core.network.api.PortalException
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.api.PortalJson
import dagger.hilt.android.qualifiers.ApplicationContext
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
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** `POST /portal/files/uploads` and `/status` (app/Http/Controllers/Files/UploadController.php). */
@Serializable
data class UploadSessionDto(val id: String, val chunkSize: Long = 8L * 1024 * 1024, val totalChunks: Int = 1, val received: List<Int> = emptyList(), val receivedCount: Int = 0, val status: String = "pending")

enum class UploadStatus { Queued, Uploading, Processing, Conflict, Completed, Failed, Cancelled }

data class UploadJob(
    val id: String,
    val uri: Uri,
    val name: String,
    val size: Long,
    val mime: String?,
    val folderId: String?,
    val status: UploadStatus = UploadStatus.Queued,
    val sessionId: String? = null,
    val chunkSize: Long = 8L * 1024 * 1024,
    val totalChunks: Int = 1,
    val received: Set<Int> = emptySet(),
    val sent: Long = 0,
    val error: String? = null,
    val conflict: UploadConflict? = null,
    val result: FileItemDto? = null,
) {
    val confirmed: Long get() = minOf(size, received.size * chunkSize)
    val progress: Float get() = if (size == 0L) 1f else ((confirmed + sent).toFloat() / size).coerceIn(0f, 1f)
    val active get() = status == UploadStatus.Queued || status == UploadStatus.Uploading || status == UploadStatus.Processing
}

data class UploadConflict(val existingName: String, val suggestion: String?)

/**
 * The chunked upload protocol (public/js/portal-upload-manager.js, appendix A3 §5):
 * init, 8 MB chunks sequentially per job with three jobs at a time and five
 * retries per chunk, resume from `/status`, complete with a conflict choice
 * on 409, abort with DELETE. Jobs survive the screen; a completed one raises
 * `completed` so the listing can insert the file.
 */
@Singleton
class UploadManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val http: PortalHttp,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val slots = Semaphore(3)
    private val jobsById = LinkedHashMap<String, Job>()
    private val _jobs = MutableStateFlow<List<UploadJob>>(emptyList())
    val jobs: StateFlow<List<UploadJob>> = _jobs.asStateFlow()
    private val _completed = MutableSharedFlow<UploadJob>(extraBufferCapacity = 16)
    val completed: SharedFlow<UploadJob> = _completed.asSharedFlow()

    fun enqueue(uris: List<Uri>, folderId: String?) {
        uris.forEach { uri ->
            val (name, size) = describe(uri)
            val job = UploadJob(UUID.randomUUID().toString(), uri, name, size, context.contentResolver.getType(uri), folderId)
            _jobs.update { it + job }
            jobsById[job.id] = scope.launch { slots.withPermit { run(job.id) } }
        }
    }

    fun cancel(id: String) {
        jobsById.remove(id)?.cancel()
        val job = _jobs.value.firstOrNull { it.id == id } ?: return
        update(id) { it.copy(status = UploadStatus.Cancelled) }
        job.sessionId?.let { sid -> scope.launch { runCatching { http.delete("/portal/files/uploads/$sid", null, OkDto.serializer()) } } }
    }

    fun retry(id: String) {
        update(id) { it.copy(status = UploadStatus.Queued, error = null) }
        jobsById[id] = scope.launch { slots.withPermit { run(id) } }
    }

    fun resolveConflict(id: String, choice: String, newName: String?) {
        update(id) { it.copy(status = UploadStatus.Processing, conflict = null) }
        jobsById[id] = scope.launch { complete(id, choice, newName) }
    }

    fun dismiss(id: String) = _jobs.update { list -> list.filter { it.id != id } }
    fun clearFinished() = _jobs.update { list -> list.filter { it.active || it.status == UploadStatus.Conflict } }

    private fun update(id: String, f: (UploadJob) -> UploadJob) = _jobs.update { list -> list.map { if (it.id == id) f(it) else it } }
    private fun job(id: String) = _jobs.value.firstOrNull { it.id == id }

    private suspend fun run(id: String) {
        var job = job(id) ?: return
        if (job.status == UploadStatus.Cancelled) return
        try {
            if (job.sessionId == null) {
                val body = buildJsonObject {
                    put("filename", job.name); put("size", job.size); put("chunkSize", job.chunkSize)
                    put("folder", job.folderId?.let { JsonPrimitive(it) } ?: JsonNull)
                    job.mime?.let { put("mime", it) }
                }
                val session = http.post("/portal/files/uploads", body, UploadSessionDto.serializer())
                update(id) { it.copy(sessionId = session.id, chunkSize = session.chunkSize, totalChunks = session.totalChunks, received = session.received.toSet(), status = UploadStatus.Uploading) }
            } else {
                val status = http.get("/portal/files/uploads/${job.sessionId}/status", UploadSessionDto.serializer())
                update(id) { it.copy(received = status.received.toSet(), status = UploadStatus.Uploading) }
            }
            job = job(id) ?: return
            var retries = 0
            while (true) {
                job = job(id) ?: return
                if (job.status == UploadStatus.Cancelled) return
                val index = (0 until job.totalChunks).firstOrNull { it !in job.received } ?: break
                try {
                    sendChunk(job, index)
                    update(id) { it.copy(received = it.received + index, sent = 0) }
                    retries = 0
                } catch (e: IOException) {
                    if (++retries > 5) throw IOException("Network interruption during upload.")
                    update(id) { it.copy(error = "Retrying… ($retries)") }
                    delay(minOf(1000L shl retries, 15_000L))
                    update(id) { it.copy(error = null) }
                } catch (e: PortalException) {
                    if (e.status in 500..599 && ++retries <= 5) { delay(minOf(1000L shl retries, 15_000L)) } else throw e
                }
            }
            complete(id, null, null)
        } catch (e: PortalException) {
            update(id) { it.copy(status = UploadStatus.Failed, error = e.message) }
        } catch (e: IOException) {
            update(id) { it.copy(status = UploadStatus.Failed, error = e.message ?: "Upload interrupted.") }
        }
    }

    private suspend fun sendChunk(job: UploadJob, index: Int) {
        val start = index * job.chunkSize
        val length = minOf(job.chunkSize, job.size - start).toInt()
        val bytes = ByteArray(length)
        context.contentResolver.openInputStream(job.uri)?.use { input ->
            var skipped = 0L
            while (skipped < start) { val n = input.skip(start - skipped); if (n <= 0) break; skipped += n }
            var read = 0
            while (read < length) { val n = input.read(bytes, read, length - read); if (n < 0) break; read += n }
        } ?: throw IOException("The file could not be read.")
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("index", index.toString())
            .addFormDataPart("chunk", job.name + ".part", bytes.toRequestBody("application/octet-stream".toMediaType()))
            .build()
        val response = http.raw(http.request("/portal/files/uploads/${job.sessionId}/chunk").post(body).build())
        response.use { if (!it.isSuccessful) { val err = PortalException.from(it); if (it.code in 500..599) throw IOException(err.message) else throw err } }
    }

    private suspend fun complete(id: String, conflict: String?, newName: String?) {
        val job = job(id) ?: return
        update(id) { it.copy(status = UploadStatus.Processing) }
        try {
            val body = buildJsonObject { put("conflict", conflict?.let { JsonPrimitive(it) } ?: JsonNull); put("newName", newName?.let { JsonPrimitive(it) } ?: JsonNull) }
            val file = http.post("/portal/files/uploads/${job.sessionId}/complete", body, FileItemDto.serializer())
            update(id) { it.copy(status = UploadStatus.Completed, result = file, sent = 0) }
            job(id)?.let { _completed.tryEmit(it) }
        } catch (e: PortalException) {
            val conflictBody = e.conflict
            if (e.status == 409 && conflictBody != null) {
                val existing = conflictBody["existingName"]?.let { (it as? JsonPrimitive)?.content } ?: job.name
                val suggestion = conflictBody["suggestion"]?.let { (it as? JsonPrimitive)?.content }
                update(id) { it.copy(status = UploadStatus.Conflict, conflict = UploadConflict(existing, suggestion)) }
            } else update(id) { it.copy(status = UploadStatus.Failed, error = e.message) }
        } catch (e: IOException) {
            update(id) { it.copy(status = UploadStatus.Failed, error = "Upload could not be completed.") }
        }
    }

    private fun describe(uri: Uri): Pair<String, Long> {
        var name = uri.lastPathSegment ?: "file"; var size = 0L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { i -> c.getString(i)?.let { name = it } }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { i -> if (!c.isNull(i)) size = c.getLong(i) }
            }
        }
        return name to size
    }
}
