package com.ferrotune.feature.home.data

import com.ferrotune.feature.playlists.data.PlaylistRepository
import javax.inject.Inject
import javax.inject.Singleton

data class HomePlaylistChoice(
    val id: String,
    val name: String,
    val type: HomePlaylistType,
)

/** Playlist and smart-playlist choices for the Home layout editors. */
@Singleton
class HomePlaylistChoicesRepository @Inject constructor(
    private val playlistRepository: PlaylistRepository,
) {
    suspend fun choices(): List<HomePlaylistChoice> {
        val playlists = playlistRepository.folders().playlists.map { playlist ->
            HomePlaylistChoice(
                id = playlist.id,
                name = playlist.name,
                type = HomePlaylistType.PLAYLIST,
            )
        }
        val smartPlaylists = playlistRepository.smartPlaylists().smartPlaylists.map { smart ->
            HomePlaylistChoice(
                id = smart.id,
                name = smart.name,
                type = HomePlaylistType.SMART_PLAYLIST,
            )
        }
        return playlists + smartPlaylists
    }
}
