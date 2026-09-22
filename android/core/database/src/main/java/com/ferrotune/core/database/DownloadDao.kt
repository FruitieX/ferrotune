package com.ferrotune.core.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface DownloadDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSong(song: DownloadedSongEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSongs(songs: List<DownloadedSongEntity>)

    @Query("DELETE FROM downloaded_songs WHERE songId = :songId")
    suspend fun deleteSong(songId: String)

    @Query("SELECT * FROM downloaded_songs ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track")
    fun songs(): Flow<List<DownloadedSongEntity>>

    @Query("SELECT * FROM downloaded_songs ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track")
    suspend fun songsOnce(): List<DownloadedSongEntity>

    @Query("SELECT songId FROM downloaded_songs")
    suspend fun songIds(): List<String>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertContainer(container: DownloadedContainerEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertContainerSongs(entries: List<DownloadedContainerSongEntity>)

    @Query("DELETE FROM downloaded_container_songs WHERE containerId = :containerId")
    suspend fun clearContainerSongs(containerId: String)

    @Query("DELETE FROM downloaded_containers WHERE containerId = :containerId")
    suspend fun deleteContainer(containerId: String)

    @Query("SELECT * FROM downloaded_containers ORDER BY name COLLATE NOCASE")
    fun containers(): Flow<List<DownloadedContainerEntity>>

    @Query(
        "SELECT c.*, (SELECT COUNT(*) FROM downloaded_container_songs s " +
            "WHERE s.containerId = c.containerId) AS songCount " +
            "FROM downloaded_containers c ORDER BY c.name COLLATE NOCASE",
    )
    fun containersWithCount(): Flow<List<ContainerWithCount>>

    @Query("SELECT * FROM downloaded_containers ORDER BY name COLLATE NOCASE")
    suspend fun containersOnce(): List<DownloadedContainerEntity>

    @Query("SELECT songId FROM downloaded_container_songs WHERE containerId = :containerId ORDER BY position")
    suspend fun containerSongIds(containerId: String): List<String>

    @Query("SELECT COUNT(*) FROM downloaded_container_songs WHERE songId = :songId")
    suspend fun containerMembershipCount(songId: String): Int

    @Query("DELETE FROM downloaded_songs")
    suspend fun clearAllSongs()

    @Query("DELETE FROM downloaded_containers")
    suspend fun clearAllContainers()

    @Query("DELETE FROM downloaded_container_songs WHERE songId = :songId")
    suspend fun removeSongFromContainers(songId: String)

    @Query(
        "DELETE FROM downloaded_containers WHERE containerId NOT IN " +
            "(SELECT DISTINCT containerId FROM downloaded_container_songs)",
    )
    suspend fun pruneEmptyContainers()
}
