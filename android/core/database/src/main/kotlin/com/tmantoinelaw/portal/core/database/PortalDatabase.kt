package com.tmantoinelaw.portal.core.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** The local store: snapshots now; the replica, cursors and the write queue join in their phases. */
@Database(entities = [SnapshotEntity::class, ReplicaFolderEntity::class, ReplicaFileEntity::class, SyncCursorEntity::class], version = 2, exportSchema = false)
abstract class PortalDatabase : RoomDatabase() {
    abstract fun snapshots(): SnapshotDao
    abstract fun replica(): ReplicaDao
}

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): PortalDatabase =
        Room.databaseBuilder(context, PortalDatabase::class.java, "tma-portal.db")
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()

    @Provides
    fun snapshots(db: PortalDatabase): SnapshotDao = db.snapshots()

    @Provides
    fun replica(db: PortalDatabase): ReplicaDao = db.replica()
}
