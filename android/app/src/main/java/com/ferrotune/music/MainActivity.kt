package com.ferrotune.music

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import com.ferrotune.core.media.PlaybackNotificationIntent
import com.ferrotune.music.navigation.FerrotuneApp
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val openNowPlaying = mutableStateOf(false)

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        openNowPlaying.value = intent.shouldOpenNowPlaying()

        setContent {
            FerrotuneApp(
                openNowPlaying = openNowPlaying.value,
                onOpenNowPlayingHandled = { openNowPlaying.value = false },
            )
        }

        requestNotificationPermissionIfNeeded()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.shouldOpenNowPlaying()) {
            openNowPlaying.value = true
        }
    }

    private fun Intent.shouldOpenNowPlaying(): Boolean =
        getBooleanExtra(PlaybackNotificationIntent.EXTRA_OPEN_NOW_PLAYING, false)

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
