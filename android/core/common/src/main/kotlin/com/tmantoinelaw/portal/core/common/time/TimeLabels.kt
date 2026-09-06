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
