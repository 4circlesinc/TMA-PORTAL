package com.tmantoinelaw.portal.core.database

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * The offline replica (docs/offline-plan.md phases 2-3, prompt §9.1): every
 * file and folder the account may see, as the server's own record JSON,
 * pulled through the sync cursors and kept until a tombstone or a full walk
 * removes it. Rows carry the account they belong to.
 */
@Entity(tableName = "replica_folders", primaryKeys = ["account", "id"], indices = [Index("account", "parentId"), Index("account", "updatedAt")])
data class ReplicaFolderEntity(val account: Long, val id: String, val parentId: String?, val name: String, val json: String, val updatedAt: String)

@Entity(tableName = "replica_files", primaryKeys = ["account", "id"], indices = [Index("account", "folderId"), Index("account", "ownerId"), Index("account", "updatedAt")])
data class ReplicaFileEntity(val account: Long, val id: String, val folderId: String?, val ownerId: Long?, val name: String, val json: String, val updatedAt: String)

/** One walker's cursor, saved after every page so a killed app loses the pages that were left, never the ones that landed. */
@Entity(tableName = "sync_cursors", primaryKeys = ["account", "walker"])
data class SyncCursorEntity(val account: Long, val walker: String, val json: String, val savedAt: Long)

@Dao
interface ReplicaDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putFolders(rows: List<ReplicaFolderEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putFiles(rows: List<ReplicaFileEntity>)
    @Query("DELETE FROM replica_folders WHERE account = :account AND id IN (:ids)") suspend fun deleteFolders(account: Long, ids: List<String>)
    @Query("DELETE FROM replica_files WHERE account = :account AND id IN (:ids)") suspend fun deleteFiles(account: Long, ids: List<String>)

    @Query("SELECT * FROM replica_folders WHERE account = :account AND ((:parent IS NULL AND parentId IS NULL) OR parentId = :parent) ORDER BY name COLLATE NOCASE")
    suspend fun childFolders(account: Long, parent: String?): List<ReplicaFolderEntity>
    @Query("SELECT * FROM replica_files WHERE account = :account AND ((:folder IS NULL AND folderId IS NULL) OR folderId = :folder) ORDER BY name COLLATE NOCASE")
    suspend fun childFiles(account: Long, folder: String?): List<ReplicaFileEntity>
    @Query("SELECT * FROM replica_folders WHERE account = :account AND id = :id LIMIT 1") suspend fun folder(account: Long, id: String): ReplicaFolderEntity?
    @Query("SELECT * FROM replica_files WHERE account = :account AND id = :id LIMIT 1") suspend fun file(account: Long, id: String): ReplicaFileEntity?
    @Query("SELECT COUNT(*) FROM replica_files WHERE account = :account") suspend fun fileCount(account: Long): Int
    @Query("SELECT COUNT(*) FROM replica_folders WHERE account = :account") suspend fun folderCount(account: Long): Int
    @Query("SELECT * FROM replica_files WHERE account = :account AND name LIKE '%' || :q || '%' ORDER BY name COLLATE NOCASE LIMIT :limit") suspend fun searchFiles(account: Long, q: String, limit: Int): List<ReplicaFileEntity>

    @Query("SELECT * FROM sync_cursors WHERE account = :account AND walker = :walker LIMIT 1") suspend fun cursor(account: Long, walker: String): SyncCursorEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putCursor(row: SyncCursorEntity)
    @Query("DELETE FROM sync_cursors WHERE account = :account AND walker = :walker") suspend fun clearCursor(account: Long, walker: String)

    @Query("DELETE FROM replica_folders WHERE account = :account") suspend fun clearFolders(account: Long)
    @Query("DELETE FROM replica_files WHERE account = :account") suspend fun clearFiles(account: Long)
}
