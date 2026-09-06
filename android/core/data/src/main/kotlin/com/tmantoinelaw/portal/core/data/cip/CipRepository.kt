package com.tmantoinelaw.portal.core.data.cip

import com.tmantoinelaw.portal.core.data.realtime.RealtimeCoordinator
import com.tmantoinelaw.portal.core.data.store.SnapshotStore
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import javax.inject.Inject
import javax.inject.Singleton

/** The applications table request (clients.js ensureApplicationTable). */
data class ApplicationsQuery(
    val phase: String? = null,
    val q: String = "",
    val bucket: Set<String> = emptySet(),
    val assignee: Set<String> = emptySet(),
    val provider: Set<String> = emptySet(),
    val sort: String? = null,
    val dir: String = "asc",
    val page: Int = 1,
) {
    val isPlain get() = q.isBlank() && bucket.isEmpty() && assignee.isEmpty() && provider.isEmpty()
    fun toQueryString(): String = buildList {
        add("perPage=50"); add("page=$page")
        phase?.let { add("phase=$it") }
        if (q.isNotBlank()) add("q=" + URLEncoder.encode(q, "UTF-8"))
        if (bucket.isNotEmpty()) add("bucket=" + bucket.joinToString(","))
        if (assignee.isNotEmpty()) add("assignee=" + assignee.joinToString(","))
        if (provider.isNotEmpty()) add("provider=" + provider.joinToString(","))
        sort?.let { add("sort=$it"); add("dir=$dir") }
    }.joinToString("&")
}

/**
 * The CIP hub's HTTP layer (public/js/clients.js, appendix A4 §5). Plain first
 * pages and opened applications are remembered as snapshots so the hub and a
 * profile open offline; transition verbs return a reduced record, so the
 * full application is re-read after every one.
 */
@Singleton
class CipRepository @Inject constructor(
    private val http: PortalHttp,
    private val snapshots: SnapshotStore,
    realtime: RealtimeCoordinator,
) {
    val changed: SharedFlow<String> = realtime.dataChanged

    private fun listKey(q: ApplicationsQuery) = if (q.isPlain && q.page == 1) "cip:list:${q.phase ?: "all"}:${q.sort ?: "-"}:${q.dir}" else null

    suspend fun cachedApplications(q: ApplicationsQuery): ApplicationsPageDto? = listKey(q)?.let { snapshots.read(it, ApplicationsPageDto.serializer()) }

    suspend fun applications(q: ApplicationsQuery): ApplicationsPageDto {
        val page = http.get("/portal/cip/applications?${q.toQueryString()}", ApplicationsPageDto.serializer())
        listKey(q)?.let { snapshots.write(it, page, ApplicationsPageDto.serializer()) }
        return page
    }

    suspend fun cachedApplication(uuid: String): ApplicationDto? = snapshots.read("cip:app:$uuid", ApplicationDto.serializer())

    suspend fun application(uuid: String): ApplicationDto {
        val app = http.get("/portal/cip/applications/$uuid", ApplicationEnvelope.serializer()).application ?: throw IllegalStateException("No application")
        snapshots.write("cip:app:$uuid", app, ApplicationDto.serializer())
        app.clientUid?.let { snapshots.write("cip:client-app:$it", app.id, String.serializer()) }
        return app
    }

    /** The door for a client uid: the application (if any) and the client record. */
    suspend fun forClient(uid: String): ApplicationEnvelope {
        val env = http.get("/portal/cip/clients/$uid/application", ApplicationEnvelope.serializer())
        env.application?.let { snapshots.write("cip:app:${it.id}", it, ApplicationDto.serializer()); snapshots.write("cip:client-app:$uid", it.id, String.serializer()) }
        env.client?.let { snapshots.write("clients:record:$uid", it, ClientRecordDto.serializer()) }
        return env
    }

    suspend fun cachedClient(uid: String): ClientRecordDto? = snapshots.read("clients:record:$uid", ClientRecordDto.serializer())
    suspend fun cachedApplicationForClient(uid: String): ApplicationDto? =
        snapshots.read("cip:client-app:$uid", String.serializer())?.let { cachedApplication(it) }

    suspend fun client(uid: String): ClientRecordDto {
        val c = http.get("/portal/clients/$uid", ClientEnvelope.serializer()).client
        snapshots.write("clients:record:$uid", c, ClientRecordDto.serializer())
        return c
    }

    suspend fun events(uuid: String): List<EventDto> = http.get("/portal/cip/applications/$uuid/events?limit=200", EventsDto.serializer()).events

    suspend fun thread(uuid: String, peek: Boolean): ThreadDto = http.get("/portal/cip/applications/$uuid/messages" + if (peek) "?peek=1" else "", ThreadDto.serializer())

    suspend fun postMessage(uuid: String, body: String, lane: String?): MessagesLaneDto =
        http.post("/portal/cip/applications/$uuid/messages", buildJsonObject { put("body", body); lane?.let { put("lane", it) } }, MessagesLaneDto.serializer())

    /** `POST …/{uuid}/status {status, note}`; the answer is reduced, so callers re-read `application()`. */
    suspend fun transition(uuid: String, status: String, note: String?): JsonElement =
        http.post("/portal/cip/applications/$uuid/status", buildJsonObject { put("status", status); note?.let { put("note", it) } }, JsonElement.serializer())

    suspend fun submit(uuid: String): JsonElement = http.post("/portal/cip/applications/$uuid/submit", null, JsonElement.serializer())

    suspend fun companies(): List<CompanyDto> {
        val list = http.get("/portal/companies", CompaniesDto.serializer()).companies
        snapshots.write("clients:companies", CompaniesDto(list), CompaniesDto.serializer())
        return list
    }
    suspend fun company(uid: String): CompanyDto {
        val c = http.get("/portal/companies/$uid", CompanyEnvelope.serializer()).company
        snapshots.write("clients:company:$uid", c, CompanyDto.serializer())
        return c
    }
    suspend fun cachedCompany(uid: String): CompanyDto? = snapshots.read("clients:company:$uid", CompanyDto.serializer()) ?: cachedCompanies()?.firstOrNull { it.id == uid }
    suspend fun cachedCompanies(): List<CompanyDto>? = snapshots.read("clients:companies", CompaniesDto.serializer())?.companies

    suspend fun buckets(): List<BucketDto> = http.get("/portal/cip/dashboard", BucketsDto.serializer()).buckets

    suspend fun assignments(uid: String): AssignmentsDto = http.get("/portal/clients/$uid/assignments", AssignmentsDto.serializer())
    suspend fun assign(uid: String, userId: Long, role: String?): AssignmentsDto =
        http.post("/portal/clients/$uid/assignments", buildJsonObject { put("userId", userId); role?.let { put("role", it) } }, AssignmentsDto.serializer())
    suspend fun unassign(uid: String, userId: Long): AssignmentsDto = http.delete("/portal/clients/$uid/assignments/$userId", null, AssignmentsDto.serializer())

    suspend fun access(uid: String): AccessDto = http.get("/portal/clients/$uid/access", AccessDto.serializer())
    suspend fun invite(uid: String): JsonElement = http.post("/portal/clients/$uid/invite", null, JsonElement.serializer())

    suspend fun conversations(uid: String): ConversationsDto = http.get("/portal/clients/$uid/conversations", ConversationsDto.serializer())
    /** `POST …/conversations {with}` answers `{conversation:{id}}`; the id opens Messages. */
    suspend fun openConversation(uid: String, with: String): JsonElement =
        http.post("/portal/clients/$uid/conversations", buildJsonObject { put("with", with) }, JsonElement.serializer())

    fun absolute(url: String?): String? = url?.let { if (it.startsWith("http")) it else http.config.url(it) }
}
