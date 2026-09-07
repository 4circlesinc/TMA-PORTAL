package com.tmantoinelaw.portal.web

import java.util.concurrent.CopyOnWriteArrayList

/**
 * The call phase the page publishes (`data-tma-call`). The full-screen call
 * activity watches this so a hangup on the other end dismisses the slider
 * without waiting for the user.
 */
object CallSession {
    @Volatile var phase: String = ""
        private set
    @Volatile var infoJson: String? = null
        private set

    private val watchers = CopyOnWriteArrayList<(String) -> Unit>()

    fun update(phase: String, infoJson: String?) {
        this.phase = phase
        if (!infoJson.isNullOrBlank()) this.infoJson = infoJson
        if (phase.isEmpty()) this.infoJson = null
        watchers.forEach { it(phase) }
    }

    fun watch(listener: (String) -> Unit) {
        watchers.add(listener)
        if (phase.isNotEmpty()) listener(phase)
    }

    fun unwatch(listener: (String) -> Unit) {
        watchers.remove(listener)
    }
}
