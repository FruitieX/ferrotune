package com.ferrotune.music.navigation

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ferrotune.feature.auth.LoginScreen
import com.ferrotune.feature.home.ui.HomeScreen
import com.ferrotune.feature.home.ui.HomeLayoutSettingsScreen
import com.ferrotune.feature.home.ui.HomeLinkTarget
import com.ferrotune.feature.home.ui.HomeSectionDetailScreen
import com.ferrotune.feature.downloads.ui.DownloadsScreen
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.theme.FerrotuneTheme
import com.ferrotune.core.model.ThemeMode
import com.ferrotune.feature.settings.ui.SettingsScreen
import com.ferrotune.feature.home.ui.ReviewScreen
import com.ferrotune.feature.home.ui.StatsScreen
import com.ferrotune.feature.library.ui.AlbumDetailScreen
import com.ferrotune.feature.library.ui.ArtistDetailScreen
import com.ferrotune.feature.library.ui.FavoritesScreen
import com.ferrotune.feature.library.ui.GenreDetailScreen
import com.ferrotune.feature.library.ui.HistoryScreen
import com.ferrotune.feature.library.ui.LibraryScreen
import com.ferrotune.feature.library.ui.SearchScreen
import com.ferrotune.feature.library.ui.SongRadioScreen
import com.ferrotune.feature.player.MiniPlayerBar
import com.ferrotune.feature.player.NowPlayingOverlay
import com.ferrotune.feature.player.rememberNowPlayingSheetState
import com.ferrotune.feature.playlists.ui.PlaylistDetailScreen
import com.ferrotune.feature.playlists.ui.PlaylistsScreen
import com.ferrotune.feature.playlists.ui.SmartPlaylistDetailScreen
import com.ferrotune.feature.playlists.ui.SmartPlaylistEditorScreen

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val LIBRARY = "library"
    const val PLAYLISTS = "playlists"
    const val SEARCH = "search"
    const val FAVORITES = "favorites"
    const val HISTORY = "history"
    const val ALBUM = "album/{albumId}"
    const val ARTIST = "artist/{artistId}"
    const val GENRE = "genre/{genre}"
    const val SONG_RADIO = "song_radio/{songId}"
    const val PLAYLIST = "playlist/{playlistId}"
    const val SMART_PLAYLIST = "smart_playlist/{smartPlaylistId}"
    const val SMART_PLAYLIST_EDITOR = "smart_playlist_editor?smartPlaylistId={smartPlaylistId}"
    const val STATS = "stats"
    const val REVIEW = "review"
    const val DOWNLOADS = "downloads"
    const val SETTINGS = "settings"
    const val HOME_LAYOUT_SETTINGS = "settings/home"
    const val HOME_SECTION = "home_section/{sectionId}"

    fun homeSection(sectionId: String) = "home_section/$sectionId"

    fun album(albumId: String) = "album/$albumId"

    fun artist(artistId: String) = "artist/$artistId"

    fun genre(genre: String) = "genre/${java.net.URLEncoder.encode(genre, "UTF-8")}"

    fun songRadio(songId: String) = "song_radio/$songId"

    fun playlist(playlistId: String) = "playlist/$playlistId"

    fun smartPlaylist(smartPlaylistId: String) = "smart_playlist/$smartPlaylistId"

    fun smartPlaylistEditor(smartPlaylistId: String? = null) =
        "smart_playlist_editor" + (smartPlaylistId?.let { "?smartPlaylistId=$it" } ?: "")
}

@Composable
fun FerrotuneApp(
    openNowPlaying: Boolean = false,
    onOpenNowPlayingHandled: () -> Unit = {},
    viewModel: AppViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val systemDark = isSystemInDarkTheme()
    val darkTheme = when (state.themeMode) {
        ThemeMode.SYSTEM -> systemDark
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }

    FerrotuneTheme(darkTheme = darkTheme, accent = state.accent) {
        FerrotuneAppContent(
            state = state,
            viewModel = viewModel,
            openNowPlaying = openNowPlaying,
            onOpenNowPlayingHandled = onOpenNowPlayingHandled,
        )
    }
}

@Composable
private fun OfflineBanner() {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = "Offline — showing downloaded content",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun FerrotuneAppContent(
    state: AppUiState,
    viewModel: AppViewModel,
    openNowPlaying: Boolean,
    onOpenNowPlayingHandled: () -> Unit,
) {
    if (state.isLoading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showChrome = currentRoute == Routes.HOME ||
        currentRoute == Routes.LIBRARY ||
        currentRoute == Routes.PLAYLISTS ||
        currentRoute == Routes.SEARCH

    val nowPlayingSheet = rememberNowPlayingSheetState()
    var nowPlayingOpen by remember { mutableStateOf(false) }

    LaunchedEffect(openNowPlaying) {
        if (openNowPlaying) {
            nowPlayingOpen = true
            onOpenNowPlayingHandled()
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
    Scaffold(
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            if (showChrome) {
                NavigationBar {
                    NavigationBarItem(
                        selected = currentRoute == Routes.HOME,
                        onClick = { navController.navigateTopLevel(Routes.HOME) },
                        icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                        label = { Text("Home") },
                    )
                    NavigationBarItem(
                        selected = currentRoute == Routes.LIBRARY,
                        onClick = { navController.navigateTopLevel(Routes.LIBRARY) },
                        icon = { Icon(Icons.Filled.LibraryMusic, contentDescription = null) },
                        label = { Text("Library") },
                    )
                    NavigationBarItem(
                        selected = currentRoute == Routes.PLAYLISTS,
                        onClick = { navController.navigateTopLevel(Routes.PLAYLISTS) },
                        icon = { Icon(Icons.Filled.QueueMusic, contentDescription = null) },
                        label = { Text("Playlists") },
                    )
                    NavigationBarItem(
                        selected = currentRoute == Routes.SEARCH,
                        onClick = { navController.navigateTopLevel(Routes.SEARCH) },
                        icon = { Icon(Icons.Filled.Search, contentDescription = null) },
                        label = { Text("Search") },
                    )
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            if (!state.isOnline) {
                OfflineBanner()
            }
            NavHost(
                navController = navController,
                startDestination = if (state.activeAccount != null) Routes.HOME else Routes.LOGIN,
                modifier = Modifier.weight(1f),
                enterTransition = { defaultEnterTransition() },
                exitTransition = { defaultExitTransition() },
                popEnterTransition = { defaultPopEnterTransition() },
                popExitTransition = { defaultPopExitTransition() },
            ) {
                composable(Routes.LOGIN) {
                    LoginScreen(
                        onLoggedIn = {
                            navController.navigate(Routes.HOME) {
                                popUpTo(Routes.LOGIN) { inclusive = true }
                            }
                        },
                    )
                }
                composable(Routes.HOME) {
                    HomeScreen(
                        accountLabel = state.activeAccount?.label,
                        accounts = state.accounts,
                        activeAccountId = state.activeAccount?.id,
                        onSwitchAccount = viewModel::switchAccount,
                        onAddAccount = { navController.navigate(Routes.LOGIN) },
                        onSignOut = {
                            viewModel.signOutLocally()
                            navController.navigate(Routes.LOGIN) {
                                popUpTo(Routes.HOME) { inclusive = true }
                            }
                        },
                        onOpenLink = { target ->
                            when (target) {
                                HomeLinkTarget.Favorites ->
                                    navController.navigate(Routes.FAVORITES)

                                HomeLinkTarget.History ->
                                    navController.navigate(Routes.HISTORY)

                                is HomeLinkTarget.Section ->
                                    navController.navigate(Routes.homeSection(target.sectionId))

                                is HomeLinkTarget.Playlist ->
                                    navController.navigate(Routes.playlist(target.id))

                                is HomeLinkTarget.SmartPlaylist ->
                                    navController.navigate(Routes.smartPlaylist(target.id))
                            }
                        },
                        onOpenAlbum = { navController.navigate(Routes.album(it)) },
                        onOpenPlaylist = { navController.navigate(Routes.playlist(it)) },
                        onOpenSmartPlaylist = {
                            navController.navigate(Routes.smartPlaylist(it))
                        },
                        onOpenStats = { navController.navigate(Routes.STATS) },
                        onOpenReview = { navController.navigate(Routes.REVIEW) },
                        onOpenDownloads = { navController.navigate(Routes.DOWNLOADS) },
                        onOpenSettings = { navController.navigate(Routes.SETTINGS) },
                    )
                }
                composable(
                    route = Routes.HOME_SECTION,
                    arguments = listOf(navArgument("sectionId") { type = NavType.StringType }),
                ) {
                    HomeSectionDetailScreen(
                        onBack = { navController.popBackStack() },
                        onOpenAlbum = { navController.navigate(Routes.album(it)) },
                        onOpenPlaylist = { navController.navigate(Routes.playlist(it)) },
                        onOpenSmartPlaylist = {
                            navController.navigate(Routes.smartPlaylist(it))
                        },
                    )
                }
                composable(Routes.LIBRARY) {
                    LibraryScreen(
                        onOpenArtist = { navController.navigate(Routes.artist(it)) },
                        onOpenAlbum = { navController.navigate(Routes.album(it)) },
                        onOpenGenre = { navController.navigate(Routes.genre(it)) },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                        onOpenFavorites = { navController.navigate(Routes.FAVORITES) },
                        onOpenHistory = { navController.navigate(Routes.HISTORY) },
                    )
                }
                composable(Routes.PLAYLISTS) {
                    PlaylistsScreen(
                        onOpenPlaylist = { navController.navigate(Routes.playlist(it)) },
                        onOpenSmartPlaylist = {
                            navController.navigate(Routes.smartPlaylist(it))
                        },
                        onCreateSmartPlaylist = {
                            navController.navigate(Routes.smartPlaylistEditor())
                        },
                    )
                }
                composable(Routes.SEARCH) {
                    SearchScreen(
                        onOpenAlbum = { navController.navigate(Routes.album(it)) },
                        onOpenArtist = { navController.navigate(Routes.artist(it)) },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                    )
                }
                composable(Routes.FAVORITES) {
                    FavoritesScreen(
                        onBack = { navController.popBackStack() },
                        onOpenAlbum = { navController.navigate(Routes.album(it)) },
                        onOpenArtist = { navController.navigate(Routes.artist(it)) },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                    )
                }
                composable(Routes.HISTORY) {
                    HistoryScreen(
                        onBack = { navController.popBackStack() },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                    )
                }
                composable(
                    route = Routes.ALBUM,
                    arguments = listOf(navArgument("albumId") { type = NavType.StringType }),
                ) {
                    AlbumDetailScreen(
                        onBack = { navController.popBackStack() },
                        onOpenArtist = { navController.navigate(Routes.artist(it)) },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                    )
                }
                composable(
                    route = Routes.ARTIST,
                    arguments = listOf(navArgument("artistId") { type = NavType.StringType }),
                ) {
                    ArtistDetailScreen(
                        onBack = { navController.popBackStack() },
                        onOpenAlbum = { navController.navigate(Routes.album(it)) },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                    )
                }
                composable(
                    route = Routes.GENRE,
                    arguments = listOf(navArgument("genre") { type = NavType.StringType }),
                ) {
                    GenreDetailScreen(
                        onBack = { navController.popBackStack() },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                    )
                }
                composable(
                    route = Routes.SONG_RADIO,
                    arguments = listOf(navArgument("songId") { type = NavType.StringType }),
                ) {
                    SongRadioScreen(onBack = { navController.popBackStack() })
                }
                composable(
                    route = Routes.PLAYLIST,
                    arguments = listOf(navArgument("playlistId") { type = NavType.StringType }),
                ) {
                    PlaylistDetailScreen(
                        onBack = { navController.popBackStack() },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                    )
                }
                composable(
                    route = Routes.SMART_PLAYLIST,
                    arguments = listOf(
                        navArgument("smartPlaylistId") { type = NavType.StringType },
                    ),
                ) { entry ->
                    SmartPlaylistDetailScreen(
                        onBack = { navController.popBackStack() },
                        onOpenPlaylist = { navController.navigate(Routes.playlist(it)) },
                        onOpenSongRadio = { navController.navigate(Routes.songRadio(it)) },
                        onEditRules = {
                            val smartPlaylistId = entry.arguments
                                ?.getString("smartPlaylistId")
                            navController.navigate(Routes.smartPlaylistEditor(smartPlaylistId))
                        },
                    )
                }
                composable(
                    route = Routes.SMART_PLAYLIST_EDITOR,
                    arguments = listOf(
                        navArgument("smartPlaylistId") {
                            type = NavType.StringType
                            nullable = true
                            defaultValue = null
                        },
                    ),
                ) {
                    SmartPlaylistEditorScreen(onDone = { navController.popBackStack() })
                }
                composable(Routes.DOWNLOADS) {
                    DownloadsScreen(onBack = { navController.popBackStack() })
                }
                composable(Routes.SETTINGS) {
                    SettingsScreen(
                        accountLabel = state.activeAccount?.label,
                        serverUrl = state.activeAccount?.serverUrl,
                        username = state.activeAccount?.username,
                        accounts = state.accounts,
                        activeAccountId = state.activeAccount?.id,
                        onSwitchAccount = viewModel::switchAccount,
                        onAddAccount = { navController.navigate(Routes.LOGIN) },
                        onOpenHomeLayout = {
                            navController.navigate(Routes.HOME_LAYOUT_SETTINGS)
                        },
                        onBack = { navController.popBackStack() },
                        onSignOut = {
                            viewModel.signOutLocally()
                            navController.navigate(Routes.LOGIN) {
                                popUpTo(Routes.HOME) { inclusive = true }
                            }
                        },
                    )
                }
                composable(Routes.HOME_LAYOUT_SETTINGS) {
                    HomeLayoutSettingsScreen(onBack = { navController.popBackStack() })
                }
                composable(Routes.STATS) {
                    StatsScreen(onBack = { navController.popBackStack() })
                }
                composable(Routes.REVIEW) {
                    ReviewScreen(
                        onBack = { navController.popBackStack() },
                        onOpenArtist = { navController.navigate(Routes.artist(it)) },
                        onOpenAlbum = { navController.navigate(Routes.album(it)) },
                    )
                }
            }
            if (showChrome) {
                MiniPlayerBar(
                    onOpenNowPlaying = { nowPlayingOpen = true },
                    onExpandDrag = nowPlayingSheet::dragBy,
                    onExpandDragEnd = {
                        if (nowPlayingSheet.shouldCloseOnRelease()) {
                            nowPlayingSheet.close()
                        } else {
                            nowPlayingOpen = true
                        }
                    },
                )
            }
        }
    }

        NowPlayingOverlay(
            open = nowPlayingOpen,
            state = nowPlayingSheet,
            onOpenChange = { nowPlayingOpen = it },
        )
    }

    state.switchError?.let { message ->
        ConfirmDialog(
            title = "Account switch failed",
            message = message,
            confirmLabel = "OK",
            onDismiss = viewModel::dismissSwitchError,
            onConfirm = viewModel::dismissSwitchError,
        )
    }
}

private fun defaultEnterTransition(): EnterTransition =
    fadeIn(tween(220)) + slideInHorizontally(tween(220)) { it / 14 }

private fun defaultExitTransition(): ExitTransition =
    fadeOut(tween(180)) + slideOutHorizontally(tween(180)) { -it / 14 }

private fun defaultPopEnterTransition(): EnterTransition =
    fadeIn(tween(220)) + slideInHorizontally(tween(220)) { -it / 14 }

private fun defaultPopExitTransition(): ExitTransition =
    fadeOut(tween(180)) + slideOutHorizontally(tween(180)) { it / 14 }

private fun androidx.navigation.NavHostController.navigateTopLevel(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
