package com.ferrotune.core.media

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaylistEditsTest {
    @Test
    fun windowThatMovedOnByATrackOnlyAppendsTheNewTail() {
        val loaded = listOf("b", "c", "d")
        val target = listOf("b", "c", "d", "e")

        assertEquals(listOf(PlaylistEdit.Insert(3, 3, 4)), playlistEdits(loaded, target))
        assertEquals(target, apply(loaded, target))
    }

    @Test
    fun windowThatDroppedItsFirstItemOnlyRemovesIt() {
        val loaded = listOf("a", "b", "c")
        val target = listOf("b", "c", "d")

        assertEquals(
            listOf(PlaylistEdit.Remove(0, 1), PlaylistEdit.Insert(2, 2, 3)),
            playlistEdits(loaded, target),
        )
        assertEquals(target, apply(loaded, target))
    }

    @Test
    fun unchangedWindowNeedsNoEdits() {
        val loaded = listOf("a", "b", "c")

        assertEquals(emptyList<PlaylistEdit>(), playlistEdits(loaded, loaded))
    }

    @Test
    fun playNextInsertsWithoutTouchingTheBufferedItems() {
        val loaded = listOf("a", "b", "c")
        val target = listOf("x", "a", "b", "c")

        assertEquals(listOf(PlaylistEdit.Insert(0, 0, 1)), playlistEdits(loaded, target))
        assertEquals(target, apply(loaded, target))
    }

    @Test
    fun movedItemIsReinsertedInsteadOfShiftingEverythingElse() {
        val loaded = listOf("a", "b", "c", "d")
        val target = listOf("d", "a", "b", "c")

        assertEquals(
            listOf(PlaylistEdit.Insert(0, 0, 1), PlaylistEdit.Remove(4, 5)),
            playlistEdits(loaded, target),
        )
        assertEquals(target, apply(loaded, target))
    }

    @Test
    fun removedItemsMergeIntoOneRemoval() {
        val loaded = listOf("a", "b", "c", "d", "e")
        val target = listOf("a", "e")

        assertEquals(listOf(PlaylistEdit.Remove(1, 4)), playlistEdits(loaded, target))
        assertEquals(target, apply(loaded, target))
    }

    @Test
    fun duplicateSongsAreMatchedByOccurrence() {
        val loaded = listOf("a", "b", "a")
        val target = listOf("a", "a", "b")

        assertEquals(target, apply(loaded, target))
    }

    @Test
    fun anyReorderingEndsAtTheTarget() {
        val loaded = listOf("a", "b", "c", "d", "e", "f")
        val targets = listOf(
            listOf("f", "e", "d", "c", "b", "a"),
            listOf("c", "a", "x", "f", "b"),
            emptyList(),
            listOf("y", "z"),
            listOf("a", "a", "b", "b"),
        )

        for (target in targets) {
            assertEquals(target, apply(loaded, target))
            assertEquals(target, apply(emptyList(), target))
            assertEquals(emptyList<String>(), apply(target, emptyList()))
        }
    }

    private fun apply(loaded: List<String>, target: List<String>): List<String> {
        val list = loaded.toMutableList()
        for (edit in playlistEdits(loaded, target)) {
            when (edit) {
                is PlaylistEdit.Remove -> list.subList(edit.fromIndex, edit.toIndex).clear()
                is PlaylistEdit.Insert ->
                    list.addAll(edit.index, target.subList(edit.newFromIndex, edit.newToIndex))
            }
        }
        return list
    }
}
