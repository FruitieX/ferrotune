package com.ferrotune.feature.feedback

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.View
import android.view.ViewParent
import android.view.Window
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Feedback
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import kotlinx.coroutines.launch

/**
 * Discreet feedback button for servers that advertise a feedback hub. Tapping it
 * captures the current screen and opens a form; "Screen" in the form arms the
 * button so the next tap captures whatever the user navigated to.
 */
@Composable
fun FeedbackOverlay(
    currentRoute: String?,
    accountKey: Any?,
    bottomPadding: Dp,
    viewModel: FeedbackViewModel = hiltViewModel(),
) {
    LaunchedEffect(accountKey) { viewModel.refresh() }
    if (viewModel.info == null) return

    val context = LocalContext.current
    var annotating by remember { mutableStateOf<Int?>(null) }

    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

    if (annotating == null) {
        Box(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(end = 12.dp, bottom = bottomPadding),
            contentAlignment = Alignment.BottomEnd,
        ) {
            FeedbackTrigger(viewModel, sheetWindow = null)
        }
    }

    if (viewModel.dialogOpen && annotating == null) {
        FeedbackDialog(
            viewModel = viewModel,
            onAnnotate = { annotating = it },
            onArmScreen = {
                viewModel.dialogOpen = false
                viewModel.armed = true
                toast("Go to the screen you want, then tap Capture")
            },
            onSend = { viewModel.send(currentRoute) { id -> toast("Thanks! Feedback #$id was sent.") } },
        )
    }

    annotating?.let { index ->
        val shot = viewModel.shots.getOrNull(index)
        if (shot == null) {
            annotating = null
        } else {
            AnnotateDialog(
                image = shot.base,
                initial = shot.strokes,
                onDone = {
                    viewModel.setStrokes(index, it)
                    annotating = null
                },
                onCancel = { annotating = null },
            )
        }
    }
}

/**
 * The feedback button inside a modal sheet (provided to the sheets through
 * `LocalSheetOverlay`): sheets are windows above the app, so the app's own
 * button sits behind them. Its capture includes the sheet.
 */
@Composable
fun SheetFeedbackButton(viewModel: FeedbackViewModel) {
    val view = LocalView.current
    FeedbackTrigger(viewModel, sheetWindow = { view.dialogWindow() })
}

/** The feedback button: capture the screen (plus [sheetWindow]) or reopen the report. */
@Composable
internal fun FeedbackTrigger(viewModel: FeedbackViewModel, sheetWindow: (() -> Window?)?) {
    if (viewModel.info == null || viewModel.hiddenForSession) return
    val context = LocalContext.current
    // Stays in composition while capturing: leaving it would cancel this scope and
    // with it the capture, leaving the button hidden and the form unopened.
    val scope = rememberCoroutineScope()

    fun captureThenOpen() {
        val activity = context.findActivity() ?: return
        val sheet = sheetWindow?.invoke()
        scope.launch {
            viewModel.capturing = true
            // Let the button disappear from the frame before copying the window.
            withFrameNanos { }
            withFrameNanos { }
            val bitmap = try {
                runCatching {
                    (if (sheet != null) activity.captureWindowWith(sheet) else activity.captureWindow()).scaledToMax()
                }.getOrNull()
            } finally {
                viewModel.capturing = false
            }
            if (bitmap != null) {
                viewModel.addShot(bitmap)
            } else {
                Toast.makeText(context, "Could not capture the screen", Toast.LENGTH_SHORT).show()
            }
            viewModel.armed = false
            viewModel.dialogOpen = true
        }
    }

    if (viewModel.capturing || viewModel.dialogOpen) return
    FeedbackButton(
        armed = viewModel.armed,
        onClick = {
            if (viewModel.armed || viewModel.shots.isEmpty()) captureThenOpen() else viewModel.dialogOpen = true
        },
        onLongClick = {
            viewModel.hiddenForSession = true
            viewModel.armed = false
            Toast.makeText(context, "Feedback button hidden until the app restarts", Toast.LENGTH_SHORT).show()
        },
    )
}

/** The window of the dialog (e.g. a modal sheet) hosting this view, if any. */
private fun View.dialogWindow(): Window? {
    var parent: ViewParent? = this as? ViewParent
    while (parent != null) {
        if (parent is DialogWindowProvider) return parent.window
        parent = parent.parent
    }
    return null
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FeedbackButton(armed: Boolean, onClick: () -> Unit, onLongClick: () -> Unit) {
    Surface(
        shape = CircleShape,
        color = if (armed) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
        contentColor = if (armed) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
        shadowElevation = 3.dp,
        modifier = Modifier
            .alpha(if (armed) 1f else 0.55f)
            .clip(CircleShape)
            .combinedClickable(
                onClickLabel = if (armed) "Capture screen for feedback" else "Send feedback",
                onLongClickLabel = "Hide feedback button",
                onClick = onClick,
                onLongClick = onLongClick,
            ),
    ) {
        Row(
            Modifier.padding(horizontal = if (armed) 16.dp else 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (armed) Icons.Outlined.PhotoCamera else Icons.Outlined.Feedback,
                contentDescription = if (armed) null else "Send feedback",
                modifier = Modifier.size(20.dp),
            )
            if (armed) {
                Spacer(Modifier.width(8.dp))
                Text("Capture", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun FeedbackDialog(
    viewModel: FeedbackViewModel,
    onAnnotate: (Int) -> Unit,
    onArmScreen: () -> Unit,
    onSend: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            scope.launch {
                context.loadImage(uri)?.let(viewModel::addShot)
                    ?: Toast.makeText(context, "Could not read the image", Toast.LENGTH_SHORT).show()
            }
        }
    }

    Dialog(
        onDismissRequest = { viewModel.dialogOpen = false },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Send feedback", style = MaterialTheme.typography.titleLarge)
                        Text(
                            "Goes to the developer's AI agents",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = { viewModel.dialogOpen = false }) {
                        Icon(Icons.Outlined.Close, contentDescription = "Close")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FeedbackKind.entries.forEach { kind ->
                        FilterChip(
                            selected = viewModel.kind == kind,
                            onClick = { viewModel.kind = kind },
                            label = { Text(kind.label) },
                        )
                    }
                }
                OutlinedTextField(
                    value = viewModel.message,
                    onValueChange = { viewModel.message = it },
                    placeholder = { Text("What happened, and what did you expect?") },
                    minLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("Screenshots", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    Text(
                        "Tap one to mark it · refer to them as #1, #2…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (viewModel.shots.isEmpty()) {
                    Text("No screenshots yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        viewModel.shots.forEachIndexed { index, shot ->
                            Column(Modifier.width(120.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Box {
                                Image(
                                    bitmap = shot.rendered.asImageBitmap(),
                                    contentDescription = "Screenshot ${index + 1}",
                                    contentScale = ContentScale.Crop,
                                    alignment = Alignment.TopCenter,
                                    modifier = Modifier
                                        .size(width = 120.dp, height = 200.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .clickable { onAnnotate(index) },
                                )
                                Surface(
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.align(Alignment.TopStart).padding(6.dp),
                                ) {
                                    Text(
                                        "#${index + 1}",
                                        style = MaterialTheme.typography.labelMedium,
                                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 1.dp),
                                    )
                                }
                                IconButton(
                                    onClick = { viewModel.removeShot(index) },
                                    modifier = Modifier.align(Alignment.TopEnd).size(32.dp),
                                ) {
                                    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.inverseSurface) {
                                        Icon(
                                            Icons.Outlined.Close,
                                            contentDescription = "Remove screenshot ${index + 1}",
                                            modifier = Modifier.padding(3.dp).size(14.dp),
                                        )
                                    }
                                }
                            }
                            OutlinedTextField(
                                value = shot.note,
                                onValueChange = { viewModel.setNote(index, it) },
                                placeholder = { Text("Note for #${index + 1}", style = MaterialTheme.typography.bodySmall) },
                                textStyle = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            }
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onArmScreen, enabled = viewModel.shots.size < MAX_SHOTS) {
                        Icon(Icons.Outlined.PhotoCamera, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Screen")
                    }
                    OutlinedButton(
                        onClick = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        enabled = viewModel.shots.size < MAX_SHOTS,
                    ) {
                        Icon(Icons.Outlined.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Image")
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = viewModel.includeDiagnostics, onCheckedChange = { viewModel.includeDiagnostics = it })
                    Text(
                        "Include screen name, device info and recent app errors",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                viewModel.status?.let {
                    Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(4.dp))
                Button(onClick = onSend, enabled = !viewModel.sending, modifier = Modifier.fillMaxWidth()) {
                    Text(if (viewModel.sending) "Sending…" else "Send")
                }
            }
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
