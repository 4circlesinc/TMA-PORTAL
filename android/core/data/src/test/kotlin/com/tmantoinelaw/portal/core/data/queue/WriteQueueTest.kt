package com.tmantoinelaw.portal.core.data.queue

import com.tmantoinelaw.portal.core.database.WriteIntentEntity
import com.tmantoinelaw.portal.core.database.WriteQueueDao
import com.tmantoinelaw.portal.core.network.NetworkState
import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.cookies.InMemoryCookieStore
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import com.tmantoinelaw.portal.core.network.session.SessionState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals

/** An in-memory stand-in for the Room table, in id order like the real one. */
private class FakeDao : WriteQueueDao {
    private var next = 1L
    val rows = MutableStateFlow<List<WriteIntentEntity>>(emptyList())
    override suspend fun insert(row: WriteIntentEntity): Long { val id = next++; rows.value = rows.value + row.copy(id = id); return id }
    override suspend fun update(row: WriteIntentEntity) { rows.value = rows.value.map { if (it.id == row.id) row else it } }
    override suspend fun delete(id: Long) { rows.value = rows.value.filter { it.id != id } }
    override suspend fun all(account: Long) = rows.value.filter { it.account == account }.sortedBy { it.id }
    override fun watch(account: Long): Flow<List<WriteIntentEntity>> = rows
    override suspend fun get(id: Long) = rows.value.firstOrNull { it.id == id }
}

private class FakeNetwork : NetworkState { override val online: StateFlow<Boolean> = MutableStateFlow(true) }

class WriteQueueTest {
    private val server = MockWebServer()
    private lateinit var queue: WriteQueue
    private lateinit var dao: FakeDao
    private lateinit var state: SessionState

    @Before
    fun setUp() {
        server.start()
        val config = PortalConfig(server.url("/").toString().trimEnd('/'), false, "TMAPortal/test (Android 16)")
        val client = OkHttpClient.Builder().cookieJar(PersistentCookieJar(InMemoryCookieStore())).followRedirects(false).build()
        state = SessionState().apply { accountId.value = 7 }
        dao = FakeDao()
        queue = WriteQueue(dao, PortalHttp(client, config, state), state, FakeNetwork())
    }

    @After
    fun tearDown() = server.shutdown()

    private fun intent(n: Int) = WriteIntent("test", "Change $n", "POST", server.url("/portal/x$n").toString(), buildJsonObject { put("n", n) })

    @Test
    fun `replays oldest first, parks a refusal, and stops at a server that is down`() = runBlocking {
        server.enqueue(MockResponse().setBody("{}"))                                        // 1 applied
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"message":"Name taken."}"""))  // 2 parked
        server.enqueue(MockResponse().setResponseCode(503))                                 // 3 stop
        queue.add(intent(1)); queue.add(intent(2)); queue.add(intent(3))
        withTimeout(5_000) { while (dao.rows.value.size != 2 || dao.rows.value.none { it.state == "failed" }) delay(20) }
        val left = dao.all(7)
        assertEquals(listOf("failed", "waiting"), left.map { it.state })
        assertEquals("Name taken.", left[0].error)
        assertEquals("Change 3", left[1].label)
        assertEquals(3, server.requestCount)
        assertEquals("/portal/x1", server.takeRequest().path)
    }

    @Test
    fun `try again re-queues a parked entry and discard removes it`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404))
        val id = queue.add(intent(1))
        withTimeout(5_000) { while (dao.rows.value.firstOrNull()?.state != "failed") delay(20) }
        assertEquals("You can no longer change this.", dao.get(id)!!.error)
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        queue.retry(id)
        withTimeout(5_000) { while (dao.rows.value.isNotEmpty()) delay(20) }
        assertEquals(0, dao.rows.value.size)
        server.enqueue(MockResponse().setResponseCode(422))
        val id2 = queue.add(intent(2))
        withTimeout(5_000) { while (dao.rows.value.firstOrNull()?.state != "failed") delay(20) }
        queue.discard(id2)
        assertEquals(0, dao.all(7).size)
    }

    @Test
    fun `deliverOrQueue queues only a delivery failure, never an answer`() = runBlocking {
        val dead = PortalHttp(OkHttpClient.Builder().followRedirects(false).build(), PortalConfig("http://127.0.0.1:1", false, "x"), state)
        val r = queue.deliverOrQueue(intent(9)) { dead.get("/me", kotlinx.serialization.json.JsonElement.serializer()) }
        assert(r is QueuedResult.Queued)
        assertEquals(1, dao.all(7).size)
    }
}
