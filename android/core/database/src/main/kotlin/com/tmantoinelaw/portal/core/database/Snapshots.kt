package com.tmantoinelaw.portal.core.database

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * A screen's remembered first page (prompt §9.1 warm boot): keyed the way the
 * web keys the store (`home:*`, `messages:*`, …), scoped to the account, and
 * ignored after seven days (portal-store.js MAX_AGE_MS).
 */
@Entity(tableName = "snapshots", primaryKeys = ["account", "key"])
data class SnapshotEntity(
    val account: Long,
    val key: String,
    val json: String,
    val savedAt: Long,
)

@Dao
interface SnapshotDao {
    @Query("SELECT * FROM snapshots WHERE account = :account AND key = :key LIMIT 1")
    suspend fun get(account: Long, key: String): SnapshotEntity?

    @Query("SELECT * FROM snapshots WHERE account = :account AND key = :key LIMIT 1")
    fun watch(account: Long, key: String): Flow<SnapshotEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entity: SnapshotEntity)

    @Query("DELETE FROM snapshots WHERE account = :account")
    suspend fun clear(account: Long)

    @Query("DELETE FROM snapshots WHERE savedAt < :before")
    suspend fun sweep(before: Long)
}
