package com.tmantoinelaw.portal.core.common.time

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The portal's relative phrasing (public/js/notify-render.js timeLabel): "Just now", "5 minutes ago", "Yesterday", "Feb 2, 2026". */
object TimeLabels {
    private val dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)

    fun parse(iso: String?): Instant? = iso?.let { runCatching { ZonedDateTime.parse(it).toInstant() }.getOrNull() ?: runCatching { Instant.parse(it) }.getOrNull() }

    /** "just now", "12 min ago", "3h ago", "5d ago" (portal-home.js workAgo). */
    fun ago(iso: String?, now: Instant = Instant.now()): String {
        val at = parse(iso) ?: return ""
        val secs = (now.epochSecond - at.epochSecond).toDouble()
        if (secs < 60) return "just now"
        if (secs < 3600) return "${Math.round(secs / 60)} min ago"
        if (secs < 86400) return "${Math.round(secs / 3600)}h ago"
        return "${Math.round(secs / 86400)}d ago"
    }

    private val clock = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    private val monthDay = DateTimeFormatter.ofPattern("MMM d", Locale.US)

    /** The time today, the day this year, otherwise the date (email.js emailTimeLabel, portal-home.js emailTime). */
    fun clockOrDate(iso: String?, fallback: String = "", now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val at = parse(iso) ?: return fallback
        val d = at.atZone(zone); val n = now.atZone(zone)
        return when {
            d.toLocalDate() == n.toLocalDate() -> clock.format(d)
            d.year == n.year -> monthDay.format(d)
            else -> dateFormat.format(d)
        }
    }

    fun relative(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val at = parse(iso) ?: return ""
        val diff = (now.epochSecond - at.epochSecond).toDouble()
        if (diff < 45) return "Just now"
        if (diff < 90) return "1 minute ago"
        if (diff < 3600) { val m = Math.round(diff / 60); return "$m minute${if (m > 1) "s" else ""} ago" }
        if (diff < 5400) return "1 hour ago"
        if (diff < 86400) { val h = Math.round(diff / 3600); return "$h hour${if (h > 1) "s" else ""} ago" }
        val today = LocalDate.ofInstant(now, zone)
        val day = LocalDate.ofInstant(at, zone)
        if (day == today.minusDays(1)) return "Yesterday"
        return dateFormat.format(at.atZone(zone))
    }
}
