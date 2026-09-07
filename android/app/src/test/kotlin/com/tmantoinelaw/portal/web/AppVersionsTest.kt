package com.tmantoinelaw.portal.web

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppVersionsTest {
    @Test
    fun `a higher patch is newer`() {
        assertTrue(AppVersions.isNewer("0.1.1", "0.1.0"))
        assertFalse(AppVersions.isNewer("0.1.0", "0.1.1"))
        assertFalse(AppVersions.isNewer("0.1.0", "0.1.0"))
    }

    @Test
    fun `uneven lengths still compare numerically`() {
        assertTrue(AppVersions.isNewer("0.2", "0.1.9"))
        assertTrue(AppVersions.isNewer("1.0.0", "0.9.9"))
        assertFalse(AppVersions.isNewer("0.1", "0.1.0"))
    }

    @Test
    fun `a later of the same version is held until the reminder window`() {
        assertFalse(AppVersions.shouldReoffer("0.2.0", 1_000L, "0.2.0", 1_000L + 60_000L, 3 * 3_600_000L))
        assertTrue(AppVersions.shouldReoffer("0.2.0", 1_000L, "0.2.0", 1_000L + 3 * 3_600_000L, 3 * 3_600_000L))
        assertTrue(AppVersions.shouldReoffer("0.2.0", 1_000L, "0.3.0", 1_001L, 3 * 3_600_000L))
        assertTrue(AppVersions.shouldReoffer(null, 0L, "0.2.0", 1L, 3 * 3_600_000L))
    }

    @Test
    fun `the releases feed yields the android apk when it is published`() {
        val body = """
            {"mac":{"available":true,"version":"0.8.0","url":"https://portal.example/desktop/download/mac"},
             "android":{"available":true,"version":"0.1.1","minOs":"8","url":"https://portal.example/desktop/download/android"}}
        """.trimIndent()
        val release = AppVersions.parseFeed(body)
        assertNotNull(release)
        assertEquals("0.1.1", release.version)
        assertEquals("https://portal.example/desktop/download/android", release.url)
    }

    @Test
    fun `an unpublished android platform is not an update`() {
        assertNull(AppVersions.parseFeed("""{"android":{"available":false}}"""))
        assertNull(AppVersions.parseFeed("{}"))
    }
}
