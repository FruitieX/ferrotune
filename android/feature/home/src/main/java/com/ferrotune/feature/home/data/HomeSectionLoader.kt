package com.ferrotune.feature.home.data

import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.SongResponse
import javax.inject.Inject
import javax.inject.Singleton

data class HomeSectionData(
    val songs: List<SongResponse> = emptyList(),
    val albums: List<AlbumResponse> = emptyList(),
    val entries: List<ContinueListeningEntry> = emptyList(),
    val seed: Long? = null,
)

/** Fetches one dashboard section's preview items, honoring its settings. */
@Singleton
class HomeSectionLoader @Inject constructor(
    private val repository: HomeRepository,
) {
    suspend fun load(
        section: HomeSectionConfig,
        size: Long = HomeRepository.DEFAULT_SECTION_SIZE,
    ): HomeSectionData = when (section.kind) {
        HomeSectionKind.CONTINUE_LISTENING -> HomeSectionData(
            entries = repository.continueListening(size).entries,
        )

        HomeSectionKind.MOST_PLAYED_RECENTLY -> HomeSectionData(
            songs = repository.mostPlayedRecently(
                since = mostPlayedRecentlySince(section.mostPlayedDays),
                size = size,
            ).song,
        )

        HomeSectionKind.RECENTLY_ADDED -> HomeSectionData(
            albums = repository.albumList(type = "newest", size = size).album,
        )

        HomeSectionKind.FORGOTTEN_FAVORITES -> repository.forgottenFavorites(
            minPlays = section.forgottenMinPlays,
            notPlayedSinceDays = section.forgottenNotPlayedDays,
            size = size,
        ).let { HomeSectionData(songs = it.song, seed = it.seed) }

        HomeSectionKind.DISCOVER -> repository.albumList(type = "random", size = size).let {
            HomeSectionData(albums = it.album, seed = it.seed)
        }

        HomeSectionKind.SIMILAR_TRACKS -> repository.similarTracks(size).let {
            HomeSectionData(songs = it.song, seed = it.seed)
        }

        HomeSectionKind.TOP_ALBUMS -> HomeSectionData(
            albums = repository.albumList(
                type = "frequent",
                size = size,
                since = mostPlayedRecentlySince(section.topAlbumsPeriodDays),
            ).album,
        )

        HomeSectionKind.RECENT_ALBUMS -> HomeSectionData(
            albums = repository.albumList(type = "recent", size = size).album,
        )

        HomeSectionKind.PLAYLIST_SONGS -> HomeSectionData(
            songs = when (section.playlistType) {
                HomePlaylistType.SMART_PLAYLIST ->
                    repository.smartPlaylistSongs(requireNotNull(section.playlistId), size)

                else -> repository.playlistSongs(requireNotNull(section.playlistId), size)
            },
        )
    }
}
