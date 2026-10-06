package com.ferrotune.feature.player

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.player.data.QueueEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class QueueInsertionPreviewTest {
    @get:Rule val compose = createComposeRule()

    @Test fun draggingShowsAnimatedInsertionBeforeCommittingMove() {
        val reorder = QueueReorderState()
        var moves = 0
        var menus = 0
        var slots = 0
        compose.setContent {
            MaterialTheme {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    repeat(3) { position ->
                        QueueRow(
                            entry = QueueEntry(position.toLong(), "entry-$position", SongResponse(
                                id = "song-$position", title = "Song $position", artist = "Artist",
                                artistId = "artist", size = 1024, contentType = "audio/flac", suffix = "flac",
                                duration = 120, path = "song.flac", created = "2026-01-01T00:00:00Z", type = "music",
                            )),
                            isCurrent = false, isPlaying = false,
                            onPlay = {}, onLongPress = { menus++ },
                            onMove = { moves++; slots = it },
                            reorderState = reorder, queueSize = 3,
                        )
                    }
                }
            }
        }
        val neighbor = compose.onNodeWithText("Song 1")
        val originalTop = neighbor.fetchSemanticsNode().boundsInRoot.top
        val slotPx = 64f * compose.density.density
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Reorder Song 0").performTouchInput {
            down(center)
            advanceEventTime(1000)
            moveBy(Offset(0f, slotPx), delayMillis = 16)
        }
        compose.mainClock.advanceTimeBy(32)
        compose.runOnIdle { assertEquals(1, reorder.preview!!.target) }
        compose.mainClock.advanceTimeBy(64)
        val midway = neighbor.fetchSemanticsNode().boundsInRoot.top
        assertTrue("Neighbor should start sliding: $midway < $originalTop", midway < originalTop)
        assertTrue(midway > originalTop - slotPx)
        compose.mainClock.advanceTimeBy(500)
        val previewTop = neighbor.fetchSemanticsNode().boundsInRoot.top
        assertEquals(originalTop - slotPx, previewTop, 0.5f)
        compose.runOnIdle {
            assertEquals(1, reorder.preview!!.target)
            assertEquals(0, moves)
            assertEquals(0, menus)
        }
        compose.onNodeWithContentDescription("Reorder Song 0").performTouchInput { up() }
        compose.mainClock.autoAdvance = true
        compose.runOnIdle {
            assertEquals(1, moves)
            assertEquals(1, slots)
        }
    }
}
