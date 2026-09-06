package com.tmantoinelaw.portal.feature.clients

import com.tmantoinelaw.portal.core.common.time.TimeLabels
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val shortDate = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.getDefault())
private val clock = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())

/** clients.js fmtShortDate: a date-only string is a calendar day, anything else is an instant in the reader's zone. */
fun fmtShortDate(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    if (iso.length == 10) return runCatching { LocalDate.parse(iso).format(shortDate) }.getOrDefault("")
    val at = TimeLabels.parse(iso) ?: return ""
    return at.atZone(ZoneId.systemDefault()).format(shortDate)
}

/** clients.js fmtDateTime: the short date plus the time, so two events on one day are distinguishable. */
fun fmtDateTime(iso: String?): String {
    val at = TimeLabels.parse(iso) ?: return ""
    val z = at.atZone(ZoneId.systemDefault())
    return z.format(shortDate) + " " + z.format(clock)
}

fun plural(n: Int, one: String, many: String = one + "s") = "$n " + if (n == 1) one else many
