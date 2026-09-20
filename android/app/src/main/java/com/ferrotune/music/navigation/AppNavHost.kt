package com.ferrotune.music.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.ferrotune.feature.library.ui.AlbumDetailScreen
import com.ferrotune.feature.library.ui.ArtistDetailScreen
import com.ferrotune.feature.library.ui.FavoritesScreen
import com.ferrotune.feature.library.ui.GenreDetailScreen
import com.ferrotune.feature.library.ui.HistoryScreen
import com.ferrotune.feature.library.ui.LibraryScreen
import com.ferrotune.feature.library.ui.SearchScreen
import com.ferrotune.feature.library.ui.SongRadioScreen
import com.ferrotune.feature.player.MiniPlayerBar
import com.ferrotune.feature.player.NowPlayingScreen

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val LIBRARY = "library"
    const val SEARCH = "search"
    const val FAVORITES = "favorites"
    const val HISTORY = "history"
    const val NOW_PLAYING = "now_playing"
    const val ALBUM = "album/{albumId}"
    const val ARTIST = "artist/{artistId}"
    const val GENRE = "genre/{genre}"
    const val SONG_RADIO = "song_radio/{songId}"

    fun album(albumId: String) = "album/$albumId"

    fun artist(artistId: String) = "artist/$artistId"

    fun genre(genre: String) = "genre/${java.net.URLEncoder.encode(genre, "UTF-8")}"

    fun songRadio(songId: String) = "song_radio/$songId"
}

@Composable
fun FerrotuneApp(
    openNowPlaying: Boolean = false,
    onOpenNowPlayingHandled: () -> Unit = {},
    viewModel: AppViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

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
        currentRoute == Routes.SEARCH

    LaunchedEffect(openNowPlaying) {
        if (openNowPlaying) {
            navController.navigate(Routes.NOW_PLAYING) { launchSingleTop = true }
            onOpenNowPlayingHandled()
        }
    }

    Scaffold(
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
            NavHost(
                navController = navController,
                startDestination = if (state.activeAccount != null) Routes.HOME else Routes.LOGIN,
                modifier = Modifier.weight(1f),
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
                        account = state.activeAccount,
                        onSwitchAccount = {
                            viewModel.signOutLocally()
                            navController.navigate(Routes.LOGIN) {
                                popUpTo(Routes.HOME) { inclusive = true }
                            }
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
                composable(Routes.NOW_PLAYING) {
                    NowPlayingScreen(onBack = { navController.popBackStack() })
                }
            }
            if (showChrome) {
                MiniPlayerBar(
                    onOpenNowPlaying = {
                        navController.navigate(Routes.NOW_PLAYING) { launchSingleTop = true }
                    },
                )
            }
        }
    }
}

private fun androidx.navigation.NavHostController.navigateTopLevel(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
