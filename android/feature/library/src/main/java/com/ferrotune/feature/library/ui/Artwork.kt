package com.ferrotune.feature.library.ui

/**
 * Coil model for server-provided inline thumbnails (`coverArtData`).
 */
fun inlineCoverModel(coverArtData: String?): String? =
    coverArtData
        ?.takeIf { it.isNotBlank() }
        ?.let { "data:image/jpeg;base64,$it" }
