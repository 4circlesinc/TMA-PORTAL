package com.tmantoinelaw.portal.core.navigation

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DeepLinksTest {
    @Test
    fun `portal paths map to their screens`() {
        assertEquals(DashboardRoute, DeepLinks.parse("/"))
        assertEquals(OverviewRoute(), DeepLinks.parse("/overview"))
        assertEquals(ActivityRoute, DeepLinks.parse("/overview", mapOf("tab" to "activity")))
        assertEquals(ClientsRoute("abc-123/edit"), DeepLinks.parse("/citizenship-applications/abc-123/edit"))
        assertEquals(ClientsRoute("abc-123"), DeepLinks.parse("/clients/abc-123"))
        assertEquals(EmailRoute(message = "u1"), DeepLinks.parse("/email", mapOf("message" to "u1")))
        assertEquals(MessagesRoute("c1"), DeepLinks.parse("/social/messages", mapOf("conversation" to "c1")))
        assertEquals(FilesRoute("all", "f1", "x1"), DeepLinks.parse("/folders/all", mapOf("folder" to "f1", "file" to "x1")))
        assertEquals(FilesRoute("shared-with-me"), DeepLinks.parse("/folders/shared-with-me"))
        assertEquals(SettingsRoute("account-security"), DeepLinks.parse("/security-settings"))
        assertEquals(SettingsRoute("theme"), DeepLinks.parse("/account-settings", mapOf("settings-page" to "theme")))
        assertEquals(WorkflowsRoute("updates"), DeepLinks.parse("/workflows/updates"))
        assertEquals(PeopleRoute("prospects"), DeepLinks.parse("/people/prospects"))
    }

    @Test
    fun `browser-only surfaces are refused`() {
        assertNull(DeepLinks.parse("/auth/login"))
        assertNull(DeepLinks.parse("/r/abcdef"))
        assertNull(DeepLinks.parse("/sign/abcdef"))
        assertNull(DeepLinks.parse("/onboarding/you"))
        assertNull(DeepLinks.parse("/privacy-policy"))
        assertNull(DeepLinks.parse("/not-a-page"))
    }

    @Test
    fun `routes print the address the web would show`() {
        assertEquals("/folders/all?folder=f1&file=x1", FilesRoute("all", "f1", "x1").path)
        assertEquals("/account-settings?settings-page=theme", SettingsRoute("theme").path)
        assertEquals("/templates", TemplatesRoute().path)
        assertEquals("/templates/email", TemplatesRoute("email").path)
    }
}
