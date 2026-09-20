package com.ferrotune.feature.library

import com.ferrotune.core.network.generated.SongResponse

internal fun testSong(id: String, title: String = "Song $id"): SongResponse = SongResponse(
    id = id,
    title = title,
    artist = "Artist",
    artistId = "artist-1",
    size = 1024,
    contentType = "audio/flac",
    suffix = "flac",
    duration = 1000,
    path = "Artist/Album/$id.flac",
    created = "2026-01-01T00:00:00.000Z",
    type = "music",
)
