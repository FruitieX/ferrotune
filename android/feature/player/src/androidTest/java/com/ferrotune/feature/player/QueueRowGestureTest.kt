package com.ferrotune.feature.player

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.player.data.QueueEntry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class QueueRowGestureTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private var menus = 0
    private var plays = 0
    private var movedSlots = 0
    private var movedFrom = -1L
    private val position = mutableLongStateOf(0)

    private fun showRow() {
        compose.activityRule.scenario.onActivity { activity ->
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        val song = SongResponse(
            id = "song-1", title = "Test song", artist = "Artist", artistId = "artist-1", size = 1024,
            contentType = "audio/flac", suffix = "flac", duration = 120,
            path = "song.flac", created = "2026-01-01T00:00:00Z", type = "music",
        )
        compose.setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize()) {
                    val rowPosition = position.longValue
                    QueueRow(
                        entry = QueueEntry(rowPosition, "entry-1", song),
                        isCurrent = false,
                        isPlaying = false,
                        onPlay = { plays++ },
                        onLongPress = { menus++ },
                        onMove = { movedSlots = it; movedFrom = rowPosition },
                    )
                }
            }
        }
    }

    private fun dragHandleDownOneSlot() {
        compose.onNodeWithContentDescription("Reorder Test song").performTouchInput {
            down(center)
            advanceEventTime(1000)
            // A row plus its gap is 64dp. Convert through the rule's density.
            val distance = 64f * compose.density.density
            moveBy(Offset(0f, distance), delayMillis = 16)
            up()
        }
    }

    @Test fun handleLongPressMovesWithoutOpeningSongMenu() {
        showRow()
        dragHandleDownOneSlot()
        compose.runOnIdle {
            assertEquals(1, movedSlots)
            assertEquals(0, menus)
            assertEquals(0, plays)
        }
    }

    @Test fun repeatedDragUsesUpdatedQueuePosition() {
        showRow()
        dragHandleDownOneSlot()
        compose.runOnIdle {
            assertEquals(0L, movedFrom)
            position.longValue = 5
        }
        dragHandleDownOneSlot()
        compose.runOnIdle {
            assertEquals(5L, movedFrom)
            assertEquals(1, movedSlots)
            assertEquals(0, menus)
        }
    }

    @Test fun songContentStillOpensMenuOnLongPress() {
        showRow()
        compose.onNodeWithText("Test song").performTouchInput { longClick() }
        compose.runOnIdle {
            assertEquals(1, menus)
            assertEquals(0, movedSlots)
            assertEquals(0, plays)
        }
    }
}
