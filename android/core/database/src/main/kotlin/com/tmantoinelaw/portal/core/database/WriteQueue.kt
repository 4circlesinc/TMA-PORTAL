package com.tmantoinelaw.portal.core.database

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

/**
 * A write that could not be delivered (docs/offline-plan.md phase 5,
 * public/js/portal-queue.js): the only copy of work a person did, kept on
 * disk, scoped to the account, replayed in id order. `parts` is the
 * multipart form as JSON (files by path), `body` a JSON body.
 */
@Entity(tableName = "write_queue")
data class WriteIntentEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val account: Long,
    val kind: String,
    val label: String,
    val method: String,
    val url: String,
    val body: String?,
    val parts: String?,
    val invalidate: String?,
    val at: Long,
    val tries: Int = 0,
    val state: String = "waiting",
    val error: String = "",
)

@Dao
interface WriteQueueDao {
    @Insert suspend fun insert(row: WriteIntentEntity): Long
    @Update suspend fun update(row: WriteIntentEntity)
    @Query("DELETE FROM write_queue WHERE id = :id") suspend fun delete(id: Long)
    @Query("SELECT * FROM write_queue WHERE account = :account ORDER BY id ASC") suspend fun all(account: Long): List<WriteIntentEntity>
    @Query("SELECT * FROM write_queue WHERE account = :account ORDER BY id ASC") fun watch(account: Long): Flow<List<WriteIntentEntity>>
    @Query("SELECT * FROM write_queue WHERE id = :id LIMIT 1") suspend fun get(id: Long): WriteIntentEntity?
}
