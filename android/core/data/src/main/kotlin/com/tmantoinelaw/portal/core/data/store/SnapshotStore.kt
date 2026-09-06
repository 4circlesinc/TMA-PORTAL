package com.tmantoinelaw.portal.core.data.store

import com.tmantoinelaw.portal.core.database.SnapshotDao
import com.tmantoinelaw.portal.core.database.SnapshotEntity
import com.tmantoinelaw.portal.core.network.api.PortalJson
import com.tmantoinelaw.portal.core.network.session.SessionState
import kotlinx.serialization.KSerializer
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Warm-boot snapshots (prompt §9.1): what a screen last saw, painted before
 * the network answers and overwritten only by a real answer. Scoped to the
 * signed-in account; entries older than seven days are ignored and swept.
 */
@Singleton
class SnapshotStore @Inject constructor(
    private val dao: SnapshotDao,
    private val session: SessionState,
) {
    private val maxAgeMs = 7L * 24 * 60 * 60 * 1000

    suspend fun <T> read(key: String, serializer: KSerializer<T>): T? {
        val account = session.accountId.value ?: return null
        val row = dao.get(account, key) ?: return null
        if (System.currentTimeMillis() - row.savedAt > maxAgeMs) return null
        return runCatching { PortalJson.decodeFromString(serializer, row.json) }.getOrNull()
    }

    suspend fun <T> write(key: String, value: T, serializer: KSerializer<T>) {
        val account = session.accountId.value ?: return
        dao.put(SnapshotEntity(account, key, PortalJson.encodeToString(serializer, value), System.currentTimeMillis()))
    }

    suspend fun clear() {
        session.accountId.value?.let { dao.clear(it) }
    }

    suspend fun sweep() = dao.sweep(System.currentTimeMillis() - maxAgeMs)
}
