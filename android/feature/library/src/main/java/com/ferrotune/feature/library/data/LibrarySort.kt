package com.ferrotune.feature.library.data

enum class SortDir(val apiValue: String) {
    ASC("asc"),
    DESC("desc"),
}

enum class SongSort(val apiValue: String) {
    TITLE("name"),
    ARTIST("artist"),
    ALBUM("album"),
    YEAR("year"),
    DURATION("duration"),
    DATE_ADDED("dateAdded"),
    PLAY_COUNT("playCount"),
    LAST_PLAYED("lastPlayed"),
}

enum class AlbumSort(val apiValue: String) {
    NAME("name"),
    ARTIST("artist"),
    YEAR("year"),
    DATE_ADDED("dateAdded"),
    SONG_COUNT("songCount"),
    LAST_PLAYED("lastPlayed"),
}

enum class ArtistSort(val apiValue: String) {
    NAME("name"),
    ALBUM_COUNT("albumCount"),
    SONG_COUNT("songCount"),
    LAST_PLAYED("lastPlayed"),
}
