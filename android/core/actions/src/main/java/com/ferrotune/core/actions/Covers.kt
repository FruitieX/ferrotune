package com.ferrotune.core.actions

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.network.coverArtUrl

/** Active account's server URL, provided by the app shell for cover-art URLs. */
val LocalServerUrl = staticCompositionLocalOf<String?> { null }

/** Cover-art tiers served by `/api/cover-art`. */
enum class CoverSize(val apiValue: String) {
    SMALL("small"),
    MEDIUM("medium"),
    LARGE("large"),
}

/**
 * Coil model for a cover like the web `CoverImage`: the inline thumbnail when
 * the response carried one, otherwise the authenticated cover-art URL.
 */
@Composable
@ReadOnlyComposable
fun coverModel(coverArtData: String?, coverArtId: String?, size: CoverSize = CoverSize.MEDIUM): Any? =
    inlineCoverModel(coverArtData) ?: coverUrl(coverArtId, size)

/** Authenticated cover-art URL for [coverArtId], or null without one. */
@Composable
@ReadOnlyComposable
fun coverUrl(coverArtId: String?, size: CoverSize = CoverSize.MEDIUM): String? {
    val serverUrl = LocalServerUrl.current ?: return null
    return coverArtId?.takeIf { it.isNotBlank() }?.let { coverArtUrl(serverUrl, it, size.apiValue) }
}

/** The original, full-size cover (web cover modal), or null without one. */
@Composable
fun fullCoverUrl(coverArtId: String?): String? {
    val serverUrl = LocalServerUrl.current ?: return null
    return coverArtId?.takeIf { it.isNotBlank() }?.let { coverArtUrl(serverUrl, it) }
}
