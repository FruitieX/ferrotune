package com.ferrotune.feature.playlists.data

import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistInFolder

data class PlaylistFolderNode(
    val folder: PlaylistFolderResponse,
    val depth: Int,
    val playlists: List<PlaylistInFolder>,
    val children: List<PlaylistFolderNode>,
)

data class PlaylistTree(
    val rootPlaylists: List<PlaylistInFolder>,
    val folders: List<PlaylistFolderNode>,
)

/**
 * Builds the folder hierarchy the browser renders. Folders and playlists are
 * ordered by their stored position (then name); playlists whose folder is
 * missing fall back to the root so they stay reachable.
 */
fun buildPlaylistTree(
    folders: List<PlaylistFolderResponse>,
    playlists: List<PlaylistInFolder>,
): PlaylistTree {
    val folderIds = folders.mapTo(mutableSetOf()) { it.id }
    val foldersByParent = folders.groupBy { folder ->
        folder.parentId?.takeIf { it in folderIds }
    }
    val playlistsByFolder = playlists
        .filter { it.folderId == null || it.folderId !in folderIds }
        .sortedWith(playlistOrder())
    val playlistsByFolderId = playlists
        .filter { it.folderId != null && it.folderId in folderIds }
        .groupBy { it.folderId }

    fun childrenOf(parentId: String?, depth: Int): List<PlaylistFolderNode> =
        (foldersByParent[parentId] ?: emptyList())
            .sortedWith(compareBy({ it.position }, { it.name.lowercase() }))
            .map { folder ->
                PlaylistFolderNode(
                    folder = folder,
                    depth = depth,
                    playlists = (playlistsByFolderId[folder.id] ?: emptyList())
                        .sortedWith(playlistOrder()),
                    children = childrenOf(folder.id, depth + 1),
                )
            }

    return PlaylistTree(
        rootPlaylists = playlistsByFolder,
        folders = childrenOf(null, 0),
    )
}

private fun playlistOrder(): Comparator<PlaylistInFolder> =
    compareBy({ it.position }, { it.name.lowercase() })

/** Finds a folder node by id anywhere in the tree (`null` for the root). */
fun PlaylistTree.folderById(id: String?): PlaylistFolderNode? {
    if (id == null) return null
    fun find(nodes: List<PlaylistFolderNode>): PlaylistFolderNode? {
        for (node in nodes) {
            if (node.folder.id == id) return node
            find(node.children)?.let { return it }
        }
        return null
    }
    return find(folders)
}

/** Subfolders shown when browsing [parentId] (`null` = root). */
fun PlaylistTree.foldersIn(parentId: String?): List<PlaylistFolderNode> =
    if (parentId == null) folders else folderById(parentId)?.children ?: emptyList()

/** Playlists shown when browsing [parentId] (`null` = root). */
fun PlaylistTree.playlistsIn(parentId: String?): List<PlaylistInFolder> =
    if (parentId == null) rootPlaylists else folderById(parentId)?.playlists ?: emptyList()

/** Root-to-folder chain used for the breadcrumb; empty for the root. */
fun PlaylistTree.folderPath(folderId: String?): List<PlaylistFolderResponse> {
    if (folderId == null) return emptyList()
    fun find(
        nodes: List<PlaylistFolderNode>,
        path: List<PlaylistFolderResponse>,
    ): List<PlaylistFolderResponse>? {
        for (node in nodes) {
            val nextPath = path + node.folder
            if (node.folder.id == folderId) return nextPath
            find(node.children, nextPath)?.let { return it }
        }
        return null
    }
    return find(folders, emptyList()) ?: emptyList()
}
