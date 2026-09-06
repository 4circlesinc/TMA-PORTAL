package com.tmantoinelaw.portal.feature.shell

import com.tmantoinelaw.portal.core.data.identity.Identity
import com.tmantoinelaw.portal.core.navigation.CalendarRoute
import com.tmantoinelaw.portal.core.navigation.CallRecordingsRoute
import com.tmantoinelaw.portal.core.navigation.ClientsRoute
import com.tmantoinelaw.portal.core.navigation.DashboardRoute
import com.tmantoinelaw.portal.core.navigation.EmailRoute
import com.tmantoinelaw.portal.core.navigation.FeedRoute
import com.tmantoinelaw.portal.core.navigation.FilesRoute
import com.tmantoinelaw.portal.core.navigation.MessagesRoute
import com.tmantoinelaw.portal.core.navigation.OverviewRoute
import com.tmantoinelaw.portal.core.navigation.PeopleRoute
import com.tmantoinelaw.portal.core.navigation.ReportingRoute
import com.tmantoinelaw.portal.core.navigation.Route
import com.tmantoinelaw.portal.core.navigation.SettingsRoute
import com.tmantoinelaw.portal.core.navigation.SignaturesRoute
import com.tmantoinelaw.portal.core.navigation.TemplatesRoute
import com.tmantoinelaw.portal.core.navigation.UsersRoute
import com.tmantoinelaw.portal.core.navigation.WorkflowsRoute
import com.tmantoinelaw.portal.core.ui.R

/**
 * One sidebar entry. `gate` mirrors app/Support/Access/Role.php PAGE_CAPABILITIES:
 * a page the account may not use does not exist (the server 404s), so the
 * entry is dropped, never greyed.
 */
data class NavItem(
    val id: String,
    val label: String,
    val route: Route,
    val icon: Int,
    val gate: (Identity) -> Boolean = { true },
    val children: List<NavItem> = emptyList(),
    /** Shown in the phone menu (resources/views/pages/dashboard.html:499-568). Groups list the child ids they surface. */
    val phone: Boolean = true,
)

/** The sidebar, in its order (resources/views/pages/dashboard.html:97-210). */
object NavTree {
    val items: List<NavItem> = listOf(
        NavItem("dash-dashboard", "Dashboard", DashboardRoute, R.drawable.ic_house),
        NavItem("dash-project-overview", "Overview", OverviewRoute(), R.drawable.ic_chart_pie_slice, { it.can("overview.view") }),
        NavItem("clients", "CIP Applications", ClientsRoute(), R.drawable.ic_users_three, { it.can("clients.view") || it.cipReach }),
        NavItem("email", "Email", EmailRoute(), R.drawable.ic_envelope_simple, { it.can("mail.use") }),
        NavItem("so-messages", "Messages", MessagesRoute(), R.drawable.ic_chats_circle),
        NavItem("so-feed", "Feed", FeedRoute, R.drawable.ic_newspaper, { it.can("feed.view") }),
        NavItem("calendar", "Calendar", CalendarRoute, R.drawable.ic_calendar_blank),
        NavItem("signatures", "Signature requests", SignaturesRoute, R.drawable.ic_signature),
        NavItem(
            "folders", "File Library", FilesRoute("all"), R.drawable.ic_folder_notch,
            children = listOf(
                NavItem("folders-all", "All Files", FilesRoute("all"), R.drawable.ic_folder_notch, { it.can("files.viewOrg") }, phone = false),
                NavItem("folders-clients", "Client Folders", FilesRoute("clients"), R.drawable.ic_folder_notch, { it.cipReach || it.can("cip.view") }, phone = false),
                NavItem("folders-personal", "Personal Folders", FilesRoute("personal"), R.drawable.ic_folder_notch),
                NavItem("folders-shared", "Shared Folders", FilesRoute("shared"), R.drawable.ic_folder_notch, { it.can("files.viewOrg") }, phone = false),
                NavItem("folders-sharedwithme", "Shared with me", FilesRoute("shared-with-me"), R.drawable.ic_folder_notch, phone = false),
                NavItem("folders-favorites", "Favorites", FilesRoute("favorites"), R.drawable.ic_folder_notch, phone = false),
                NavItem("folders-recent", "Recent", FilesRoute("recent"), R.drawable.ic_folder_notch, phone = false),
                NavItem("folders-filebox", "File Box", FilesRoute("filebox"), R.drawable.ic_folder_notch, phone = false),
                NavItem("folders-recycle", "Recycle Bin", FilesRoute("recycle"), R.drawable.ic_folder_notch, phone = false),
            ),
        ),
        NavItem("users", "Users", UsersRoute(), R.drawable.ic_user_list, { it.can("users.view") }),
        NavItem("reporting", "Reporting", ReportingRoute, R.drawable.ic_chart_bar, { it.can("settings.reporting") }),
        NavItem(
            "templates", "Templates", TemplatesRoute(), R.drawable.ic_table, { it.canAny("templates.view", "templates.email") },
            children = listOf(
                NavItem("templates-system", "System emails", TemplatesRoute("system"), R.drawable.ic_table, { it.can("templates.view") }),
                NavItem("templates-email", "Email templates", TemplatesRoute("email"), R.drawable.ic_table, { it.can("templates.email") }),
                NavItem("templates-letters", "Granted and Denied letters", TemplatesRoute("letters"), R.drawable.ic_table, { it.can("templates.view") }),
                NavItem("templates-documents", "Document requirements", TemplatesRoute("documents"), R.drawable.ic_table, { it.can("templates.view") }),
            ),
        ),
        NavItem(
            "workflows", "Workflows", WorkflowsRoute(), R.drawable.ic_arrows_clockwise, { it.can("workflows.view") },
            children = listOf(
                NavItem("workflows-automated", "Requests", WorkflowsRoute("requests"), R.drawable.ic_arrows_clockwise),
                NavItem("workflows-feedback", "Feedback and Comments", WorkflowsRoute("feedback"), R.drawable.ic_arrows_clockwise, phone = false),
                NavItem("workflows-updates", "Updates required", WorkflowsRoute("updates"), R.drawable.ic_arrows_clockwise),
            ),
        ),
        NavItem("call-recordings", "Call Recordings", CallRecordingsRoute, R.drawable.ic_phone_call, { it.can("callRecordings.view") }),
        NavItem(
            "people", "People", PeopleRoute(), R.drawable.ic_user_list, { it.can("directory.view") },
            children = listOf(
                NavItem("people-home", "Manage users", PeopleRoute("home"), R.drawable.ic_user_list),
                NavItem("people-employees", "Browse Employees", PeopleRoute("employees"), R.drawable.ic_user_list, phone = false),
                NavItem("people-clients", "Browse client contacts", PeopleRoute("clients"), R.drawable.ic_user_list, { it.can("clients.view") }, phone = false),
                NavItem("people-prospects", "Browse prospects", PeopleRoute("prospects"), R.drawable.ic_user_list, { it.can("clients.view") }, phone = false),
                NavItem("people-shared-address", "Shared Address Book", PeopleRoute("shared-address-book"), R.drawable.ic_user_list, phone = false),
                NavItem("people-personal-address", "Personal Address Book", PeopleRoute("personal-address-book"), R.drawable.ic_user_list, phone = false),
                NavItem("people-groups", "Distribution Groups", PeopleRoute("distribution-groups"), R.drawable.ic_user_list, { it.can("groups.view") }, phone = false),
                NavItem("people-resend", "Resend Welcome Emails", PeopleRoute("resend-welcome-emails"), R.drawable.ic_user_list, { it.can("users.manage") }, phone = false),
            ),
        ),
        NavItem("account-settings", "Settings", SettingsRoute(), R.drawable.ic_gear_six),
    )

    /** The tree the account may see. A group with no visible child is dropped too. */
    fun visible(identity: Identity): List<NavItem> = items.mapNotNull { item ->
        if (!item.gate(identity)) return@mapNotNull null
        if (item.children.isEmpty()) return@mapNotNull item
        val kids = item.children.filter { it.gate(identity) }
        if (kids.isEmpty()) null else item.copy(children = kids)
    }

    /** The phone menu: top-level rows plus the children the web lists (dashboard.html:499-568). */
    fun phone(identity: Identity): List<NavItem> = visible(identity).flatMap { item ->
        if (item.children.isEmpty()) listOf(item) else item.children.filter { it.phone }
    }

    /** Every settings rail page and the capability it needs (app/Support/Access/Role.php settings map, prompt §8.3). */
    val settingsPages: List<SettingsPage> = listOf(
        SettingsPage("profile", "My profile", "Personal"),
        SettingsPage("theme", "Theme", "Personal"),
        SettingsPage("time", "Time and language", "Personal"),
        SettingsPage("notifications", "Notifications", "Personal"),
        SettingsPage("privacy", "Privacy", "Personal"),
        SettingsPage("account-security", "Account security", "Personal"),
        SettingsPage("connectors", "Connectors", "Personal"),
        SettingsPage("background-ops", "Background Operations", "System", "settings.operations"),
        SettingsPage("notification-history", "Notification History", "System", "settings.reporting"),
        SettingsPage("branding", "Edit Company Branding", "System", "settings.branding"),
        SettingsPage("cip-admin", "Administrator", "Client hub management", "settings.clientHub"),
        SettingsPage("clienthub-access", "Access", "Client hub management", "settings.clientHub"),
        SettingsPage("service-teams", "Service teams", "Client hub management", "settings.clientHub"),
        SettingsPage("custom-fields", "Custom fields", "Client hub management", "settings.clientHub"),
        SettingsPage("cip-documents", "Document requirements", "Client hub management", "settings.clientHub"),
        SettingsPage("cip-letters", "Granted and Denied letters", "Client hub management", "settings.clientHub"),
        SettingsPage("cip-distribution", "Distribution group", "Client hub management", "settings.clientHub"),
        SettingsPage("security-insights", "Security Insights", "Security", "settings.security"),
        SettingsPage("signin-policy", "Sign in policy", "Security", "settings.security"),
        SettingsPage("security-policy", "Security policy", "Security", "settings.security"),
        SettingsPage("alert-settings", "Security alert settings", "Security", "settings.security"),
        SettingsPage("device-security", "Configure device security", "Security", "settings.security"),
        SettingsPage("storage-usage", "Usage", "Storage", "settings.storage"),
        SettingsPage("permissions", "Permissions", "Advanced", "settings.advanced"),
        SettingsPage("default-folders", "Default Folders", "File Library", "files.settings"),
        SettingsPage("folder-templates", "Folder Templates", "File Library", "files.settings"),
    )

    fun settingsFor(identity: Identity): List<SettingsPage> = settingsPages.filter { it.capability == null || identity.can(it.capability) }
}

data class SettingsPage(val id: String, val label: String, val section: String, val capability: String? = null)
