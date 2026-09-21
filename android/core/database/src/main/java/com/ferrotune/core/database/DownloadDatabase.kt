package com.ferrotune.core.database

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

@Database(
    entities = [
        DownloadedSongEntity::class,
        DownloadedContainerEntity::class,
        DownloadedContainerSongEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class DownloadDatabase : RoomDatabase() {
    abstract fun downloadDao(): DownloadDao

    companion object {
        const val NAME = "ferrotune-downloads.db"
    }
}

@Module
@InstallIn(SingletonComponent::class)
object DownloadDatabaseModule {
    @Provides
    @Singleton
    fun provideDownloadDatabase(@ApplicationContext context: Context): DownloadDatabase =
        Room.databaseBuilder(context, DownloadDatabase::class.java, DownloadDatabase.NAME).build()

    @Provides
    fun provideDownloadDao(database: DownloadDatabase): DownloadDao = database.downloadDao()
}
