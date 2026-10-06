package com.ferrotune.feature.player

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.VerticalAlignCenter
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.LocalPinnableContainer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.collectAsLazyPagingItems
import com.ferrotune.core.actions.CoverSize
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.closingBeforeNavigation
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.toMenuTarget
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.NowPlayingBars
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.formatClockDuration
import com.ferrotune.feature.player.data.QueueEntry
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val QueueRowHeight = 60.dp
private val QueueRowGap = 4.dp

/** Opens the app-wide queue panel; provided by the app shell via [LocalQueuePanel]. */
@Stable
class QueuePanelState {
    var isOpen by mutableStateOf(false)
        private set

    fun open() {
        isOpen = true
    }

    fun close() {
        isOpen = false
    }
}

val LocalQueuePanel = staticCompositionLocalOf { QueuePanelState() }

/**
 * Web mobile queue: a full-screen panel that slides in from the right (swipe
 * right or press back to close) with "Queue", jump-to-current, Clear, and the
 * "Playing from" source row above the whole virtualized queue. The app shell
 * draws it above the player so the mini player and Now Playing share it.
 */
@Composable
fun QueuePanelHost(
    state: QueuePanelState,
    viewModel: QueueSheetViewModel = hiltViewModel(),
) {
    if (state.isOpen) {
        QueuePanel(onDismiss = state::close, viewModel = viewModel)
    }
}

@Composable
private fun QueuePanel(onDismiss: () -> Unit, viewModel: QueueSheetViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val entries = viewModel.entries.collectAsLazyPagingItems()
    val listState = rememberLazyListState()
    val reorder = remember { QueueReorderState() }
    val scope = rememberCoroutineScope()
    val songMenu = rememberSongMenuState()
    var menuEntry by remember { mutableStateOf<QueueEntry?>(null) }
    var moveEntry by remember { mutableStateOf<QueueEntry?>(null) }
    var confirmClear by remember { mutableStateOf(false) }
    var widthPx by remember { mutableFloatStateOf(0f) }
    // 0 = off screen to the right, 1 = fully shown.
    val shown = remember { Animatable(0f) }
    val density = LocalDensity.current

    fun close() {
        scope.launch {
            shown.animateTo(0f, tween(250))
            onDismiss()
        }
    }

    val appActions = LocalMediaActions.current
    val actions = remember(appActions) { appActions.closingBeforeNavigation(onDismiss) }

    LaunchedEffect(Unit) { shown.animateTo(1f, tween(320)) }
    LaunchedEffect(Unit) { viewModel.reload() }
    LaunchedEffect(Unit) { viewModel.pageRefreshes.collect { entries.refresh() } }
    LaunchedEffect(state.sessionId, entries.itemCount) { reorder.cancel() }
    // A settled move leaves the preview up until the reloaded rows show it;
    // clear it then, or after a while when the move failed.
    val preview = reorder.visiblePreview { entries.peek(it)?.entryId }
    val pendingMove = reorder.preview?.takeIf { it.settled }

    // Scroll while a held row is near the list's top or bottom edge; the row
    // follows the content by the scrolled distance so it stays under the finger.
    var listTop by remember { mutableFloatStateOf(0f) }
    var listBottom by remember { mutableFloatStateOf(0f) }
    val holding = reorder.preview?.settled == false
    LaunchedEffect(holding) {
        if (!holding) return@LaunchedEffect
        val slotPx = with(density) { (QueueRowHeight + QueueRowGap).toPx() }
        val edgePx = with(density) { 72.dp.toPx() }
        val maxSpeed = with(density) { 18.dp.toPx() }
        while (reorder.preview?.settled == false) {
            withFrameNanos { }
            val speed = queueAutoScrollSpeed(reorder.pointerY, listTop, listBottom, edgePx, maxSpeed)
            if (speed != 0f) {
                val scrolled = listState.scrollBy(speed)
                if (scrolled != 0f) reorder.dragBy(scrolled, slotPx, entries.itemCount)
            }
        }
    }
    // The list keeps its first visible row in place by key when the reloaded
    // rows arrive. If the preview had shifted that row to make room, undo the
    // shift by scrolling, so nothing moves when the move lands.
    var anchorShift by remember { mutableIntStateOf(0) }
    LaunchedEffect(pendingMove) {
        anchorShift = pendingMove?.displacement(listState.firstVisibleItemIndex) ?: 0
    }
    LaunchedEffect(pendingMove, preview == null) {
        if (pendingMove == null) return@LaunchedEffect
        if (preview == null) {
            if (anchorShift != 0) {
                listState.scrollBy(-anchorShift * with(density) { (QueueRowHeight + QueueRowGap).toPx() })
            }
            reorder.cancel()
        } else {
            delay(5_000)
            reorder.cancel()
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.reload() }
    BackHandler { close() }

    // Open scrolled to the current track once its page is in.
    var scrolledToCurrent by remember { mutableStateOf(false) }
    LaunchedEffect(entries.itemCount, state.currentIndex) {
        if (!scrolledToCurrent && entries.itemCount > 0 && state.currentIndex in 0 until entries.itemCount) {
            listState.scrollToItem((state.currentIndex - 2).coerceAtLeast(0))
            scrolledToCurrent = true
        }
    }

    CompositionLocalProvider(
        LocalMediaActions provides actions,
        LocalContentColor provides MaterialTheme.colorScheme.onSurface,
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { widthPx = it.width.toFloat() }
                .background(Color.Black.copy(alpha = 0.5f * shown.value)),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer { translationX = (1f - shown.value) * size.width }
                    .background(MaterialTheme.colorScheme.background)
                    .draggable(
                        orientation = Orientation.Horizontal,
                        state = rememberDraggableState { delta ->
                            if (widthPx > 0f) {
                                scope.launch { shown.snapTo((shown.value - delta / widthPx).coerceIn(0f, 1f)) }
                            }
                        },
                        onDragStopped = { velocity ->
                            if (shown.value < 0.7f || velocity > with(density) { 800.dp.toPx() }) {
                                close()
                            } else {
                                shown.animateTo(1f, tween(200))
                            }
                        },
                    )
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                QueueHeader(
                    hasEntries = entries.itemCount > 0,
                    onJumpToCurrent = {
                        scope.launch { listState.animateScrollToItem((state.currentIndex - 2).coerceAtLeast(0)) }
                    },
                    onClear = { confirmClear = true },
                    onClose = ::close,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                state.sourceName?.takeIf { state.sourceType != "other" }?.let { source ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.QueueMusic,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(14.dp),
                        )
                        Text(
                            text = "Playing from $source",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
                if (entries.itemCount == 0) {
                    EmptyState(
                        message = "Queue is empty",
                        icon = Icons.AutoMirrored.Filled.QueueMusic,
                        description = "Play something to fill the queue.",
                    )
                } else Box(modifier = Modifier.fillMaxSize()) {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .fillMaxSize()
                            .onGloballyPositioned { coordinates ->
                                val bounds = coordinates.boundsInRoot()
                                listTop = bounds.top
                                listBottom = bounds.bottom
                            },
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(QueueRowGap),
                    ) {
                        items(
                            count = entries.itemCount,
                            key = { index -> entries.peek(index)?.entryId ?: "placeholder-$index" },
                            contentType = { "queue-entry" },
                        ) { index ->
                            val entry = entries[index]
                            if (entry == null) {
                                ShimmerBox(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(QueueRowHeight),
                                    shape = RoundedCornerShape(8.dp),
                                )
                            } else {
                                val isCurrent = index == state.currentIndex
                                QueueRow(
                                    entry = entry,
                                    reorderState = reorder,
                                    preview = preview,
                                    queueSize = entries.itemCount,
                                    // Reorders draw their own motion; a placement animation would
                                    // replay the move from the old slot when the reloaded rows land.
                                    modifier = Modifier.animateItem(placementSpec = null),
                                    isCurrent = isCurrent,
                                    isPlaying = isCurrent && state.isPlaying,
                                    onPlay = { viewModel.jumpTo(index) },
                                    onLongPress = {
                                        menuEntry = entry
                                        songMenu.open(entry.song.toMenuTarget())
                                    },
                                    onMove = { slots -> viewModel.moveTo(entry, entry.position + slots) },
                                )
                            }
                        }
                    }
                    // The held row, floating under the finger above the list.
                    val floating = reorder.held
                    val pointerY = reorder.pointerY
                    if (floating != null && !pointerY.isNaN()) {
                        val floatingCurrent = floating.position.toInt() == state.currentIndex
                        QueueRow(
                            entry = floating,
                            isCurrent = floatingCurrent,
                            isPlaying = floatingCurrent && state.isPlaying,
                            onPlay = {},
                            onLongPress = {},
                            onMove = {},
                            floating = true,
                            modifier = Modifier
                                .padding(horizontal = 8.dp)
                                .offset { IntOffset(0, (pointerY - reorder.grabOffset - listTop).roundToInt()) },
                        )
                    }
                }
            }
        }

        SongMenuSheet(
            state = songMenu,
            onPlay = { menuEntry?.let { viewModel.jumpTo(it.position.toInt()) } },
            extraActions = {
                val entry = menuEntry
                if (entry == null || entry.position.toInt() == state.currentIndex) {
                    emptyList()
                } else {
                    listOf(
                        MediaAction("Move to position", Icons.Filled.SwapVert, separatorBefore = true) {
                            moveEntry = entry
                        },
                        MediaAction("Remove from queue", Icons.Filled.Delete, destructive = true) {
                            viewModel.remove(entry)
                        },
                    )
                }
            },
        )
    }

    moveEntry?.let { entry ->
        MoveToPositionDialog(
            current = entry.position.toInt() + 1,
            max = entries.itemCount,
            onDismiss = { moveEntry = null },
            onMove = { position ->
                viewModel.moveTo(entry, (position - 1).toLong())
                moveEntry = null
            },
        )
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Clear queue") },
            text = { Text("Remove all ${entries.itemCount} tracks from the queue?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmClear = false
                        viewModel.clear()
                    },
                ) { Text("Clear") }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun QueueHeader(
    hasEntries: Boolean,
    onJumpToCurrent: () -> Unit,
    onClear: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.AutoMirrored.Filled.QueueMusic, contentDescription = null, modifier = Modifier.size(20.dp))
        Text(
            text = "Queue",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .weight(1f)
                .padding(start = 8.dp),
        )
        if (hasEntries) {
            IconButton(onClick = onJumpToCurrent) {
                Icon(
                    Icons.Filled.VerticalAlignCenter,
                    contentDescription = "Jump to now playing",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
            TextButton(onClick = onClear) {
                Icon(
                    Icons.Filled.DeleteSweep,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    "Clear",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 6.dp),
                )
            }
        }
        IconButton(onClick = onClose) {
            Icon(Icons.Filled.Close, contentDescription = "Close queue", modifier = Modifier.size(20.dp))
        }
    }
}

/** Web queue row: card tile, now-playing bars, cover, title + "artist · album", duration, drag handle. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun QueueRow(
    entry: QueueEntry,
    isCurrent: Boolean,
    isPlaying: Boolean,
    onPlay: () -> Unit,
    onLongPress: () -> Unit,
    onMove: (Int) -> Unit,
    reorderState: QueueReorderState? = null,
    preview: QueueReorderPreview? = reorderState?.preview,
    queueSize: Int = Int.MAX_VALUE,
    floating: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val reorder = reorderState ?: remember { QueueReorderState() }
    val colors = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(8.dp)
    val density = LocalDensity.current
    val slotPx = with(density) { (QueueRowHeight + QueueRowGap).toPx() }
    val dragging = preview?.entryId == entry.entryId
    val held = dragging && preview?.settled == false
    // While held the row follows the finger; on release it springs into the
    // target slot. When the preview ends (the reloaded rows already sit in
    // their new slots) every row snaps to its layout position.
    val translation by animateFloatAsState(
        targetValue = if (dragging) preview?.offsetY ?: 0f
            else (preview?.displacement(entry.position.toInt()) ?: 0) * slotPx,
        animationSpec = if (held || preview == null) snap() else spring(),
        label = "Queue insertion preview",
    )
    val move by rememberUpdatedState(onMove)
    // Keep the held row composed while edge scrolling carries its slot off screen,
    // or the drag gesture would be cancelled.
    val pinnable = LocalPinnableContainer.current
    DisposableEffect(held, pinnable) {
        val handle = if (held) pinnable?.pin() else null
        onDispose { handle?.release() }
    }
    var handleCoordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
    var rowCoordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val song = entry.song
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(QueueRowHeight)
            .onGloballyPositioned { rowCoordinates = it }
            .zIndex(if (dragging) 1f else 0f),
    ) {
        if (held && preview != null) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .graphicsLayer { translationY = (preview.target - preview.from) * slotPx }
                    .background(colors.primary.copy(alpha = 0.08f), shape)
                    .border(1.dp, colors.primary.copy(alpha = 0.4f), shape),
            )
        }
        Row(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    translationY = translation
                    shadowElevation = if (floating) 8.dp.toPx() else 0f
                    // The panel draws the held row floating under the finger.
                    alpha = if (held) 0f else 1f
                }
                .background(
                    when {
                        floating -> colors.surfaceContainerHigh
                        isCurrent -> colors.primary.copy(alpha = 0.1f)
                        else -> colors.surfaceContainerLow
                    },
                    shape,
                )
                .then(if (isCurrent) Modifier.border(1.dp, colors.primary.copy(alpha = 0.2f), shape) else Modifier)
                .padding(start = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Keep the handle outside the clickable content so its long press
            // cannot also open the song menu.
            Row(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxSize()
                    .combinedClickable(onClick = onPlay, onLongClick = onLongPress),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (isCurrent) {
                    NowPlayingBars(isAnimating = isPlaying, modifier = Modifier.width(20.dp))
                }
                CoverArt(
                    model = coverModel(song.coverArtData, song.coverArt, CoverSize.SMALL),
                    contentDescription = null,
                    seed = song.album ?: song.title,
                    shape = RoundedCornerShape(4.dp),
                    modifier = Modifier.size(40.dp),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = song.title,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = if (isCurrent) colors.primary else colors.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = listOfNotNull(song.artist, song.album).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    text = formatClockDuration(song.duration * 1000),
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                    color = colors.onSurfaceVariant,
                )
            }
            Icon(
                imageVector = Icons.Filled.DragHandle,
                contentDescription = "Reorder ${song.title}",
                tint = colors.onSurfaceVariant,
                modifier = Modifier
                    .size(44.dp)
                    .onGloballyPositioned { handleCoordinates = it }
                    .pointerInput(entry.entryId, entry.position, queueSize, slotPx) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { offset ->
                                reorder.start(entry.entryId, entry.position.toInt())
                                val handle = handleCoordinates?.takeIf { it.isAttached }
                                val row = rowCoordinates?.takeIf { it.isAttached }
                                if (handle != null && row != null) {
                                    reorder.grab(entry, handle.localToRoot(offset).y, row.positionInRoot().y)
                                }
                            },
                            onDrag = { change, amount ->
                                change.consume()
                                reorder.dragBy(amount.y, slotPx, queueSize)
                                handleCoordinates?.takeIf { it.isAttached }?.let {
                                    reorder.pointerY = it.localToRoot(change.position).y
                                }
                            },
                            onDragEnd = {
                                val slots = reorder.finish(slotPx)
                                if (slots != 0) move(slots)
                            },
                            onDragCancel = {
                                reorder.cancel()
                            },
                        )
                    }
                    .padding(10.dp),
            )
        }
    }
}

/** Web `MoveToPositionDialog`: enter a 1-based queue position. */
@Composable
private fun MoveToPositionDialog(
    current: Int,
    max: Int,
    onDismiss: () -> Unit,
    onMove: (Int) -> Unit,
) {
    var text by remember { mutableStateOf(current.toString()) }
    val position = text.toIntOrNull()?.takeIf { it in 1..max }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Move to position") },
        text = {
            Column {
                Text(
                    text = "Position 1–$max",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it.filter(Char::isDigit) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { position?.let(onMove) }, enabled = position != null) { Text("Move") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
