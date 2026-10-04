package com.ferrotune.music.navigation

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.MediaActions
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.feature.downloads.ui.SongDownloadMenuItem as DownloadMenuItem
import com.ferrotune.feature.playlists.ui.AddToPlaylistDialog

/**
 * App-shell implementation of [MediaActions]: routes "Go to …" items through
 * the nav controller and hosts the shared "Add to playlist" dialog, so every
 * screen's rows and sheets get the same behavior.
 */
private class AppMediaActions(
    private val navController: NavHostController,
    private val downloads: DownloadActionViewModel,
    private val onAddToPlaylist: (List<String>) -> Unit,
) : MediaActions {
    private var lastRoute: String? = null
    private var lastNavigationAt = 0L

    /**
     * Ignores a repeat of the same navigation within a short window, so a
     * double tap (or a tap landing during the enter transition) can't stack
     * two copies of one screen.
     */
    fun navigate(route: String) {
        val now = SystemClock.elapsedRealtime()
        if (route == lastRoute && now - lastNavigationAt < DUPLICATE_NAVIGATION_WINDOW_MS) return
        lastRoute = route
        lastNavigationAt = now
        navController.navigate(route)
    }

    override fun openAlbum(albumId: String) = navigate(Routes.album(albumId))

    override fun openArtist(artistId: String) = navigate(Routes.artist(artistId))

    override fun openGenre(genre: String) = navigate(Routes.genre(genre))

    override fun openSongRadio(songId: String) = navigate(Routes.songRadio(songId))

    override fun openPlaylist(playlistId: String) = navigate(Routes.playlist(playlistId))

    override fun openSmartPlaylist(smartPlaylistId: String) =
        navigate(Routes.smartPlaylist(smartPlaylistId))

    override fun addToPlaylist(songIds: List<String>) {
        if (songIds.isNotEmpty()) onAddToPlaylist(songIds)
    }

    override fun downloadSongs(songIds: List<String>) = downloads.downloadSongs(songIds)

    @Composable
    override fun SongDownloadMenuItem(songId: String) {
        DownloadMenuItem(songId = songId, viewModel = downloads)
    }

    private companion object {
        const val DUPLICATE_NAVIGATION_WINDOW_MS = 700L
    }
}

@Composable
fun ProvideMediaActions(
    navController: NavHostController,
    content: @Composable () -> Unit,
) {
    val downloads: DownloadActionViewModel = hiltViewModel()
    var addToPlaylistSongIds by remember { mutableStateOf<List<String>?>(null) }
    val actions = remember(navController, downloads) {
        AppMediaActions(navController, downloads) { addToPlaylistSongIds = it }
    }
    CompositionLocalProvider(LocalMediaActions provides actions, content = content)

    addToPlaylistSongIds?.let { songIds ->
        AddToPlaylistDialog(
            songIds = songIds,
            onDismiss = { addToPlaylistSongIds = null },
            onAdded = { addToPlaylistSongIds = null },
        )
    }
}

/** Same double-tap guard for callers outside [MediaActions] (routes in the nav host). */
internal fun MediaActions.navigateTo(route: String) {
    (this as? AppMediaActions)?.navigate(route)
}
