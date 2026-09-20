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
