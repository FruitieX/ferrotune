package com.ferrotune.core.actions

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * App-level navigation and cross-feature actions that list rows and action
 * sheets need regardless of which screen hosts them ("Go to album", "Add to
 * playlist", downloads). The app shell provides the implementation through
 * [LocalMediaActions], so feature screens don't thread these callbacks
 * through every composable.
 */
interface MediaActions {
    fun openAlbum(albumId: String)

    fun openArtist(artistId: String)

    fun openGenre(genre: String)

    fun openSongRadio(songId: String)

    fun openPlaylist(playlistId: String)

    fun openSmartPlaylist(smartPlaylistId: String)

    /** Opens the shared "Add to playlist" picker for [songIds]. */
    fun addToPlaylist(songIds: List<String>)

    fun downloadSongs(songIds: List<String>)

    /** "Download" / "Remove download" row for one song inside an action sheet. */
    @Composable
    fun SongDownloadMenuItem(songId: String)
}

/** No-op actions used by previews and tests. */
object NoOpMediaActions : MediaActions {
    override fun openAlbum(albumId: String) = Unit

    override fun openArtist(artistId: String) = Unit

    override fun openGenre(genre: String) = Unit

    override fun openSongRadio(songId: String) = Unit

    override fun openPlaylist(playlistId: String) = Unit

    override fun openSmartPlaylist(smartPlaylistId: String) = Unit

    override fun addToPlaylist(songIds: List<String>) = Unit

    override fun downloadSongs(songIds: List<String>) = Unit

    @Composable
    override fun SongDownloadMenuItem(songId: String) = Unit
}

val LocalMediaActions = staticCompositionLocalOf<MediaActions> { NoOpMediaActions }

/**
 * Wraps these actions so every navigation first runs [close], for overlays
 * (player, queue) that must get out of the way of the destination screen.
 */
fun MediaActions.closingBeforeNavigation(close: () -> Unit): MediaActions =
    ClosingMediaActions(this, close)

private class ClosingMediaActions(
    private val delegate: MediaActions,
    private val close: () -> Unit,
) : MediaActions by delegate {
    override fun openAlbum(albumId: String) = close().also { delegate.openAlbum(albumId) }

    override fun openArtist(artistId: String) = close().also { delegate.openArtist(artistId) }

    override fun openGenre(genre: String) = close().also { delegate.openGenre(genre) }

    override fun openSongRadio(songId: String) = close().also { delegate.openSongRadio(songId) }

    override fun openPlaylist(playlistId: String) = close().also { delegate.openPlaylist(playlistId) }

    override fun openSmartPlaylist(smartPlaylistId: String) =
        close().also { delegate.openSmartPlaylist(smartPlaylistId) }
}
