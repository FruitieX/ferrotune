package com.ferrotune.feature.playlists.data

import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistInFolder
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaylistFolderTreeTest {

    private fun folder(
        id: String,
        name: String = "Folder $id",
        parentId: String? = null,
        position: Long = 0,
    ) = PlaylistFolderResponse(
        id = id,
        name = name,
        parentId = parentId,
        position = position,
        createdAt = "2026-01-01T00:00:00.000Z",
        hasCoverArt = false,
    )

    private fun playlist(
        id: String,
        name: String = "Playlist $id",
        folderId: String? = null,
        position: Long = 0,
    ) = PlaylistInFolder(
        id = id,
        name = name,
        folderId = folderId,
        owner = "tester",
        public = false,
        position = position,
        songCount = 1,
        duration = 60,
        created = "2026-01-01T00:00:00.000Z",
        changed = "2026-01-01T00:00:00.000Z",
        sharedWithMe = false,
        canEdit = true,
    )

    @Test
    fun `nests folders by parent and keeps playlists in their folder`() {
        val tree = buildPlaylistTree(
            folders = listOf(
                folder("a", name = "Alpha", position = 0),
                folder("b", name = "Beta", parentId = "a", position = 0),
            ),
            playlists = listOf(
                playlist("p1", folderId = "a"),
                playlist("p2", folderId = "b"),
                playlist("p3"),
            ),
        )

        assertEquals(listOf("p3"), tree.rootPlaylists.map { it.id })
        val alpha = tree.folders.single()
        assertEquals("a", alpha.folder.id)
        assertEquals(listOf("p1"), alpha.playlists.map { it.id })
        assertEquals("b", alpha.children.single().folder.id)
        assertEquals(listOf("p2"), alpha.children.single().playlists.map { it.id })
        assertEquals(1, alpha.children.single().depth)
    }

    @Test
    fun `orders folders and playlists by position then name`() {
        val tree = buildPlaylistTree(
            folders = listOf(
                folder("late", name = "Zeta", position = 5),
                folder("early", name = "Beta", position = 1),
                folder("tie", name = "Alpha", position = 1),
            ),
            playlists = listOf(
                playlist("b", name = "Beta", position = 1),
                playlist("a", name = "Alpha", position = 1),
                playlist("first", name = "First", position = 0),
            ),
        )

        assertEquals(
            listOf("tie", "early", "late"),
            tree.folders.map { it.folder.id },
        )
        assertEquals(listOf("first", "a", "b"), tree.rootPlaylists.map { it.id })
    }

    @Test
    fun `orphaned folders and playlists surface at the root`() {
        val tree = buildPlaylistTree(
            folders = listOf(
                folder("orphan", name = "Orphan", parentId = "missing"),
                folder("child", name = "Child", parentId = "orphan"),
            ),
            playlists = listOf(
                playlist("p1", folderId = "missing"),
                playlist("p2", folderId = "orphan"),
            ),
        )

        assertEquals(listOf("p1"), tree.rootPlaylists.map { it.id })
        val orphan = tree.folders.single()
        assertEquals("orphan", orphan.folder.id)
        assertEquals(listOf("p2"), orphan.playlists.map { it.id })
        assertEquals("child", orphan.children.single().folder.id)
    }

    @Test
    fun `browsing a folder exposes only its direct children`() {
        val tree = buildPlaylistTree(
            folders = listOf(
                folder("a"),
                folder("b", parentId = "a"),
                folder("c", parentId = "b"),
            ),
            playlists = listOf(
                playlist("p1", folderId = "a"),
                playlist("p2", folderId = "b"),
                playlist("p3", folderId = "c"),
                playlist("root"),
            ),
        )

        assertEquals(listOf("root"), tree.playlistsIn(null).map { it.id })
        assertEquals(listOf("a"), tree.foldersIn(null).map { it.folder.id })
        assertEquals(listOf("p1"), tree.playlistsIn("a").map { it.id })
        assertEquals(listOf("b"), tree.foldersIn("a").map { it.folder.id })
        assertEquals(listOf("p2"), tree.playlistsIn("b").map { it.id })
        assertEquals(listOf("c"), tree.foldersIn("b").map { it.folder.id })
        assertEquals(listOf("p3"), tree.playlistsIn("c").map { it.id })
        assertEquals(emptyList<String>(), tree.foldersIn("c").map { it.folder.id })
    }

    @Test
    fun `folder lookup ignores unknown ids`() {
        val tree = buildPlaylistTree(folders = listOf(folder("a")), playlists = emptyList())

        assertEquals("a", tree.folderById("a")?.folder?.id)
        assertEquals(null, tree.folderById("missing"))
        assertEquals(null, tree.folderById(null))
        assertEquals(emptyList<String>(), tree.playlistsIn("missing").map { it.id })
    }

    @Test
    fun `folder path walks from the root to the folder`() {
        val tree = buildPlaylistTree(
            folders = listOf(
                folder("a", name = "Alpha"),
                folder("b", name = "Beta", parentId = "a"),
                folder("c", name = "Gamma", parentId = "b"),
            ),
            playlists = emptyList(),
        )

        assertEquals(emptyList<String>(), tree.folderPath(null).map { it.id })
        assertEquals(listOf("a"), tree.folderPath("a").map { it.id })
        assertEquals(listOf("a", "b", "c"), tree.folderPath("c").map { it.id })
        assertEquals(emptyList<String>(), tree.folderPath("missing").map { it.id })
    }
}
