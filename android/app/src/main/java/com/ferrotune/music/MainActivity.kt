package com.ferrotune.music

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.ferrotune.core.designsystem.theme.FerrotuneTheme
import com.ferrotune.music.navigation.FerrotuneApp
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            FerrotuneTheme {
                FerrotuneApp()
            }
        }
    }
}
