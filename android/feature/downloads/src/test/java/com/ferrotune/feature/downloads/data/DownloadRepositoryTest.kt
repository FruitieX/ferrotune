package com.ferrotune.feature.downloads.data

import com.ferrotune.core.database.DownloadContainerType
import com.ferrotune.core.database.DownloadedSongEntity
import com.ferrotune.core.media.DownloadInfo
import com.ferrotune.core.media.DownloadStateEventPayload
import com.ferrotune.core.network.generated.CollectionSongsResponse
import com.ferrotune.core.network.generated.GetPreferenceResponse
import com.ferrotune.core.network.generated.PlaylistSongEntry
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.PlaylistSongsResponse
import com.ferrotune.core.network.generated.SetPreferenceRequest
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

internal fun testSongResponse(id: String): SongResponse = SongResponse(
    id = id,
    title = "Song $id",
    album = "Album",
    albumId = "album-1",
    artist = "Artist",
    artistId = "artist-1",
    track = 1,
    coverArt = "cover-$id",
    size = 1024,
    contentType = "audio/flac",
    suffix = "flac",
    duration = 180,
    path = "Artist/Album/$id.flac",
    created = "2026-01-01T00:00:00.000Z",
    type = "music",
)

internal class FakeDownloadApi : FakeFerrotuneApi() {
    val preferenceValues = mutableMapOf<String, JsonElement>()

    override suspend fun preferences(): PreferencesResponse = PreferencesResponse(
        accentColor = "rust",
        preferences = preferenceValues.toMap(),
    )

    override suspend fun setPreference(
        key: String,
        request: SetPreferenceRequest,
    ): GetPreferenceResponse {
        preferenceValues[key] = request.value
        return GetPreferenceResponse(key = key, value = request.value)
    }

    override suspend fun song(id: String) = com.ferrotune.core.network.generated.FerrotuneSongResponse(
        song = testSongResponse(id),
    )

    override suspend fun albumSongs(
        id: String,
        params: Map<String, String>,
    ): CollectionSongsResponse = CollectionSongsResponse(
        songs = listOf(testSongResponse("$id-1"), testSongResponse("$id-2")),
        total = 2,
        offset = 0,
    )

    override suspend fun playlistSongs(
        id: String,
        params: Map<String, String>,
    ): PlaylistSongsResponse = PlaylistSongsResponse(
        id = id,
        name = "Playlist",
        owner = "tester",
        public = false,
        totalEntries = 2,
        matchedCount = 2,
        missingCount = 0,
        duration = 360,
        filteredCount = 2,
        created = "2026-01-01T00:00:00.000Z",
        changed = "2026-01-01T00:00:00.000Z",
        sharedWithMe = false,
        canEdit = true,
        entries = listOf(
            PlaylistSongEntry(
                entryId = "e1",
                position = 0,
                entryType = "song",
                song = testSongResponse("p-1"),
            ),
            PlaylistSongEntry(
                entryId = "e2",
                position = 1,
                entryType = "song",
                song = null,
            ),
        ),
    )
}

class DownloadRepositoryTest {

    private fun repository(
        engine: FakeDownloadEngine = FakeDownloadEngine(),
        dao: FakeDownloadDao = FakeDownloadDao(),
        api: FakeDownloadApi = FakeDownloadApi(),
    ): DownloadRepository {
        val provider = FakeApiProvider(api)
        return DownloadRepository(engine, dao, provider, DownloadSettingsRepository(provider, engine))
    }

    @Test
    fun `initializes the engine and mirrors the snapshot`() = runTest {
        val engine = FakeDownloadEngine().apply {
            snapshotResult = listOf(
                DownloadInfo(
                    contentId = "audio:song-1",
                    songId = "song-1",
                    kind = "audio",
                    status = DownloadStatus.COMPLETED,
                    percent = 100f,
                    bytesDownloaded = 10,
                    bytesTotal = 10,
                ),
                DownloadInfo(
                    contentId = "cover:song-1",
                    songId = "song-1",
                    kind = "cover",
                    status = DownloadStatus.COMPLETED,
                    percent = 100f,
                    bytesDownloaded = 1,
                    bytesTotal = 1,
                ),
            )
        }

        val repository = repository(engine)

        assertTrue(engine.initialized)
        assertEquals(1, repository.states.value.size)
        assertTrue(repository.states.value["song-1"]!!.isDownloaded)
    }

    @Test
    fun `engine events update download state`() = runTest {
        val engine = FakeDownloadEngine()
        val repository = repository(engine)
        withContext(Dispatchers.Default) {
            withTimeout(5_000) { engine.events.subscriptionCount.first { it > 0 } }
        }

        engine.events.emit(
            DownloadStateEventPayload(
                downloads = listOf(
                    DownloadInfo(
                        contentId = "audio:song-1",
                        songId = "song-1",
                        kind = "audio",
                        status = DownloadStatus.DOWNLOADING,
                        percent = 42f,
                        bytesDownloaded = 42,
                        bytesTotal = 100,
                    ),
                ),
                paused = false,
                notMetRequirements = 0,
            ),
        )

        val state = withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                repository.states.first { it["song-1"]?.status == DownloadStatus.DOWNLOADING }
            }
        }
        assertEquals(42f, state["song-1"]?.percent)
    }

    @Test
    fun `enqueueSong fetches metadata and persists it`() = runTest {
        val engine = FakeDownloadEngine()
        val dao = FakeDownloadDao()
        val repository = repository(engine, dao)

        repository.enqueueSong("song-1")

        assertEquals(listOf(Triple("song-1", "opus", 128)), engine.enqueued)
        val song = dao.songs.value.single()
        assertEquals("song-1", song.songId)
        assertEquals("Song song-1", song.title)
        assertEquals("cover-song-1", song.coverArtId)
        assertEquals("flac", song.fileFormat)
    }

    @Test
    fun `downloadAlbum records container membership and enqueues every song`() = runTest {
        val engine = FakeDownloadEngine()
        val dao = FakeDownloadDao()
        val repository = repository(engine, dao)

        repository.downloadAlbum("album-1", "Album", "cover-1")

        assertEquals(listOf("album-1-1", "album-1-2"), engine.enqueued.map { it.first })
        val containerId = DownloadContainerType.id(DownloadContainerType.ALBUM, "album-1")
        assertEquals(
            listOf("album-1-1", "album-1-2"),
            dao.containerSongIds(containerId),
        )
        assertEquals(2, dao.songs.value.size)
        withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                repository.downloadedContainerIds.first { containerId in it }
            }
        }
    }

    @Test
    fun `downloadPlaylist skips missing entries`() = runTest {
        val engine = FakeDownloadEngine()
        val dao = FakeDownloadDao()
        val repository = repository(engine, dao)

        repository.downloadPlaylist("playlist-1", "Playlist", null)

        assertEquals(listOf("p-1"), engine.enqueued.map { it.first })
        assertEquals(listOf("p-1"), dao.songIds())
    }

    @Test
    fun `removeSong cancels, deletes, and prunes empty containers`() = runTest {
        val engine = FakeDownloadEngine()
        val dao = FakeDownloadDao()
        val repository = repository(engine, dao)
        repository.downloadAlbum("album-1", "Album", null)

        repository.removeSong("album-1-1")

        assertEquals(listOf("album-1-1"), engine.cancelled)
        assertFalse("album-1-1" in dao.songIds())
        assertEquals(listOf("album-1-2"), dao.containerSongIds(
            DownloadContainerType.id(DownloadContainerType.ALBUM, "album-1"),
        ))
    }

    @Test
    fun `removeContainer keeps songs shared with other containers`() = runTest {
        val engine = FakeDownloadEngine()
        val dao = FakeDownloadDao()
        val repository = repository(engine, dao)
        repository.downloadAlbum("album-1", "Album", null)
        repository.downloadPlaylist("playlist-1", "Playlist", null)
        // playlist-1 contains p-1; give album-1 a shared song p-1
        val albumContainer = DownloadContainerType.id(DownloadContainerType.ALBUM, "album-1")
        dao.upsertContainerSongs(
            listOf(
                com.ferrotune.core.database.DownloadedContainerSongEntity(
                    containerId = albumContainer,
                    songId = "p-1",
                    position = 2,
                ),
            ),
        )

        repository.removeContainer(albumContainer)

        assertTrue("p-1" in dao.songIds())
        assertFalse("album-1-1" in dao.songIds())
        withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                repository.downloadedContainerIds.first { albumContainer !in it }
            }
        }
    }

    @Test
    fun `clearAll wipes engine and metadata`() = runTest {
        val engine = FakeDownloadEngine()
        val dao = FakeDownloadDao()
        val repository = repository(engine, dao)
        repository.downloadAlbum("album-1", "Album", null)

        repository.clearAll()

        assertTrue(engine.removedAll)
        assertTrue(dao.songs.value.isEmpty())
        assertTrue(dao.containers.value.isEmpty())
    }

    @Test
    fun `offline queue materializes in container order with start index`() {
        val songs = listOf(
            testEntity("a"),
            testEntity("b"),
            testEntity("c"),
        )

        val response = materializeOfflineQueue(
            songs = songs,
            sourceType = "album",
            sourceId = "album-1",
            startSongId = "b",
        )

        assertEquals("album", response.sourceType)
        assertEquals(3, response.totalCount)
        assertEquals(1, response.currentIndex)
        assertEquals(listOf("a", "b", "c"), response.window.songs.map { it.song.id })
        assertEquals("offline:b", response.window.songs[1].entryId)
    }

    @Test
    fun `offline source uses downloaded container songs and falls back to all`() = runTest {
        val dao = FakeDownloadDao()
        val repository = repository(dao = dao)
        repository.downloadAlbum("album-1", "Album", null)
        repository.enqueueSong("loose-song")
        val source = RoomOfflineQueueSource(dao)

        val albumQueue = source.offlineQueue("album", "album-1", null)
        assertEquals(listOf("album-1-1", "album-1-2"), albumQueue!!.window.songs.map { it.song.id })

        assertNull(source.offlineQueue("library", null, null))
        assertNull(source.offlineQueue("album", "unknown", null))
    }

    private fun testEntity(id: String) = DownloadedSongEntity(
        songId = id,
        title = "Song $id",
        artist = "Artist",
        artistId = "artist-1",
        album = "Album",
        albumId = "album-1",
        duration = 180,
        track = 1,
        coverArtId = null,
        coverArtData = null,
        fileFormat = "flac",
        downloadedAt = 0,
    )
}
