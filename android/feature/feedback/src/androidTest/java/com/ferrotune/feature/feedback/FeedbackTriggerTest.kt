package com.ferrotune.feature.feedback

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import com.ferrotune.core.network.FerrotuneApiProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test

class FeedbackTriggerTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val unusedApi = object : FerrotuneApiProvider {
        override suspend fun requireApi() = error("not used")
        override suspend fun requireAccount() = error("not used")
    }

    @Test
    fun tapCapturesTheScreenAndOpensTheForm() {
        val viewModel = FeedbackViewModel(FeedbackRepository(unusedApi), compose.activity.applicationContext)
        viewModel.info = FeedbackServerInfo("https://music.test", "1.0", "https://feedback.test")
        compose.setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize()) {
                    FeedbackTrigger(viewModel, sheetWindow = null)
                }
            }
        }

        compose.onNodeWithContentDescription("Send feedback").performClick()

        // The button hides itself while capturing; the capture must still finish.
        compose.waitUntil(timeoutMillis = 5_000) { viewModel.dialogOpen }
        assertFalse(viewModel.capturing)
        assertEquals(1, viewModel.shots.size)
    }
}
