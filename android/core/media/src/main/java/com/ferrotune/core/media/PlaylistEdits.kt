package com.ferrotune.core.media

/**
 * An edit to a segment of the player's playlist. Indices are relative to the
 * segment and apply in order: each edit sees the list as the previous ones
 * left it.
 */
internal sealed interface PlaylistEdit {
    /** Removes the items in [fromIndex, toIndex). */
    data class Remove(val fromIndex: Int, val toIndex: Int) : PlaylistEdit

    /** Inserts the new items in [newFromIndex, newToIndex) at [index]. */
    data class Insert(val index: Int, val newFromIndex: Int, val newToIndex: Int) : PlaylistEdit
}

/**
 * Edits that turn [loaded] into [target] while keeping the items both share in
 * place. ExoPlayer keeps the buffered audio of items it keeps, but replacing a
 * segment wholesale releases every buffered period after the current item and
 * downloads them again. A queue window that moved by one track costs one
 * removal and one append; a moved item is re-inserted rather than shifting
 * everything between its old and new place.
 */
internal fun <T> playlistEdits(loaded: List<T>, target: List<T>): List<PlaylistEdit> {
    val edits = mutableListOf<PlaylistEdit>()
    // Occurrences of each item still to place, so a loaded item that the rest
    // of the target needs is kept for later instead of being removed now.
    val remaining = target.groupingBy { it }.eachCount().toMutableMap()
    var loadedIndex = 0
    var cursor = 0
    var insertStart = -1

    fun flushInsert(targetIndex: Int) {
        if (insertStart < 0) return
        val count = targetIndex - insertStart
        edits += PlaylistEdit.Insert(cursor - count, insertStart, targetIndex)
        insertStart = -1
    }

    fun remove(count: Int) {
        val last = edits.lastOrNull()
        edits += if (last is PlaylistEdit.Remove && last.fromIndex == cursor) {
            edits.removeAt(edits.lastIndex)
            PlaylistEdit.Remove(cursor, last.toIndex + count)
        } else {
            PlaylistEdit.Remove(cursor, cursor + count)
        }
    }

    for ((targetIndex, item) in target.withIndex()) {
        while (
            loadedIndex < loaded.size &&
            loaded[loadedIndex] != item &&
            (remaining[loaded[loadedIndex]] ?: 0) == 0
        ) {
            flushInsert(targetIndex)
            remove(1)
            loadedIndex++
        }
        if (loadedIndex < loaded.size && loaded[loadedIndex] == item) {
            flushInsert(targetIndex)
            loadedIndex++
        } else if (insertStart < 0) {
            insertStart = targetIndex
        }
        cursor++
        remaining[item] = (remaining[item] ?: 1) - 1
    }
    flushInsert(target.size)
    if (loadedIndex < loaded.size) remove(loaded.size - loadedIndex)
    return edits
}
