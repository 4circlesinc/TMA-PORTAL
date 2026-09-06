package com.tmantoinelaw.portal.core.network

import com.tmantoinelaw.portal.core.network.realtime.PusherFrame
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PusherFrameTest {
    @Test
    fun `data arrives as a JSON string and is parsed twice`() {
        val f = PusherFrame.parse("""{"event":"pusher:connection_established","data":"{\"socket_id\":\"123.456\",\"activity_timeout\":30}"}""")!!
        assertEquals("pusher:connection_established", f.event)
        assertNull(f.channel)
        assertEquals("123.456", f.string("socket_id"))
    }

    @Test
    fun `channel events keep their channel and broadcastAs name`() {
        val f = PusherFrame.parse("""{"event":"message.sent","channel":"private-conversation.abc","data":"{\"conversationId\":\"abc\",\"seq\":42}"}""")!!
        assertEquals("private-conversation.abc", f.channel)
        assertEquals("42", f.string("seq"))
    }

    @Test
    fun `subscribe and pong frames are what Reverb expects`() {
        assertEquals("""{"event":"pusher:pong","data":{}}""", PusherFrame.pong())
        assertEquals("""{"event":"pusher:subscribe","data":{"channel":"private-portal.staff","auth":"k:sig"}}""", PusherFrame.subscribe("private-portal.staff", "k:sig", null))
        assertEquals("""{"event":"pusher:unsubscribe","data":{"channel":"private-x"}}""", PusherFrame.unsubscribe("private-x"))
    }

    @Test
    fun `garbage is ignored`() {
        assertNull(PusherFrame.parse("not json"))
        assertNull(PusherFrame.parse("""{"data":"{}"}"""))
    }
}
