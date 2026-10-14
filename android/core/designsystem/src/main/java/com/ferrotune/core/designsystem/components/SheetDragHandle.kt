package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Drawn at the end of every modal sheet's drag handle row. A sheet is its own
 * window above the app, so overlays the app draws in its window (the feedback
 * button) end up behind it; the app shell provides them here as well.
 */
val LocalSheetOverlay = staticCompositionLocalOf<(@Composable () -> Unit)?> { null }

/** The drag handle for modal sheets, with [LocalSheetOverlay] at its end. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SheetDragHandle() {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        BottomSheetDefaults.DragHandle()
        LocalSheetOverlay.current?.let { overlay ->
            Box(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp)) { overlay() }
        }
    }
}
