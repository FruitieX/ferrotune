package com.ferrotune.music.navigation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Box
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.ferrotune.feature.auth.LoginScreen
import com.ferrotune.feature.player.MiniPlayerBar
import com.ferrotune.feature.player.NowPlayingScreen

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val NOW_PLAYING = "now_playing"
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

    LaunchedEffect(openNowPlaying) {
        if (openNowPlaying) {
            navController.navigate(Routes.NOW_PLAYING) { launchSingleTop = true }
            onOpenNowPlayingHandled()
        }
    }

    NavHost(
        navController = navController,
        startDestination = if (state.activeAccount != null) Routes.HOME else Routes.LOGIN,
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
            Column(Modifier.fillMaxSize()) {
                HomeScreen(
                    account = state.activeAccount,
                    onSwitchAccount = {
                        viewModel.signOutLocally()
                        navController.navigate(Routes.LOGIN) {
                            popUpTo(Routes.HOME) { inclusive = true }
                        }
                    },
                    modifier = Modifier.weight(1f),
                )
                MiniPlayerBar(
                    onOpenNowPlaying = {
                        navController.navigate(Routes.NOW_PLAYING) { launchSingleTop = true }
                    },
                )
            }
        }
        composable(Routes.NOW_PLAYING) {
            NowPlayingScreen(onBack = { navController.popBackStack() })
        }
    }
}
