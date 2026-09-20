package com.ferrotune.feature.playlists.data

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.dto.CreateFolderRequest
import com.ferrotune.core.network.dto.GetPlaylistSongsParams
import com.ferrotune.core.network.dto.MovePlaylistRequest
import com.ferrotune.core.network.dto.ReorderPlaylistRequest
import com.ferrotune.core.network.dto.SmartPlaylistSongsParams
import com.ferrotune.core.network.dto.UpdateFolderRequest
import com.ferrotune.core.network.generated.AddPlaylistSongsRequest
import com.ferrotune.core.network.generated.CreateSmartPlaylistRequest
import com.ferrotune.core.network.generated.CreateSmartPlaylistResponse
import com.ferrotune.core.network.generated.ImportPlaylistRequest
import com.ferrotune.core.network.generated.ImportPlaylistResponse
import com.ferrotune.core.network.generated.MaterializeSmartPlaylistRequest
import com.ferrotune.core.network.generated.MaterializeSmartPlaylistResponse
import com.ferrotune.core.network.generated.MovePlaylistEntryRequest
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistFoldersResponse
import com.ferrotune.core.network.generated.PlaylistMembershipRequest
import com.ferrotune.core.network.generated.PlaylistMembershipResponse
import com.ferrotune.core.network.generated.PlaylistSharesResponse
import com.ferrotune.core.network.generated.PlaylistSongsResponse
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.RecentPlaylistsResponse
import com.ferrotune.core.network.generated.RemovePlaylistSongsRequest
import com.ferrotune.core.network.generated.SetPlaylistSharesRequest
import com.ferrotune.core.network.generated.ShareEntry
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.core.network.generated.SmartPlaylistsResponse
import com.ferrotune.core.network.generated.UpdatePlaylistRequest
import com.ferrotune.core.network.generated.UpdateSmartPlaylistRequest
import com.ferrotune.core.network.paging.DEFAULT_PAGE_SIZE
import com.ferrotune.core.network.toQueryMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.JsonElement

/**
 * Playlist folders, playlists, smart playlists, shares, and offline
 * membership reads/mutations.
 */
@Singleton
class PlaylistRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    suspend fun folders(): PlaylistFoldersResponse = apiProvider.requireApi().playlistFolders()

    suspend fun recentlyPlayed(): RecentPlaylistsResponse =
        apiProvider.requireApi().recentlyPlayedPlaylists()

    suspend fun createFolder(name: String, parentId: String? = null): PlaylistFolderResponse =
        apiProvider.requireApi().createPlaylistFolder(CreateFolderRequest(name, parentId))

    suspend fun updateFolder(
        folderId: String,
        name: String? = null,
        parentId: JsonElement? = null,
    ): PlaylistFolderResponse = apiProvider.requireApi()
        .updatePlaylistFolder(folderId, UpdateFolderRequest(name = name, parentId = parentId))

    suspend fun deleteFolder(folderId: String) {
        apiProvider.requireApi().deletePlaylistFolder(folderId)
    }

    suspend fun createPlaylist(
        name: String,
        songIds: List<String> = emptyList(),
        sources: List<QueueSourceRequest> = emptyList(),
        folderId: String? = null,
        comment: String? = null,
    ): ImportPlaylistResponse = apiProvider.requireApi().importPlaylist(
        ImportPlaylistRequest(
            name = name,
            comment = comment,
            entries = songIds.map { com.ferrotune.core.network.generated.ImportPlaylistEntry(songId = it) },
            sources = sources,
            folderId = folderId,
        )
    )

    suspend fun playlist(playlistId: String, offset: Int = 0, count: Int = DEFAULT_PAGE_SIZE) =
        apiProvider.requireApi().playlistSongs(
            playlistId,
            GetPlaylistSongsParams(offset = offset, count = count).toQueryMap(),
        )

    fun playlistSongs(
        playlistId: String,
        sort: String = PLAYLIST_SORT_CUSTOM,
        sortDir: String = "asc",
        filter: String? = null,
        entryType: String? = null,
    ) = PlaylistEntriesPagingSource(
        apiProvider = apiProvider,
        playlistId = playlistId,
        sort = sort,
        sortDir = sortDir,
        filter = filter,
        entryType = entryType,
    )

    suspend fun updatePlaylist(
        playlistId: String,
        name: String? = null,
        comment: String? = null,
        public: Boolean? = null,
    ): PlaylistSongsResponse = apiProvider.requireApi().updatePlaylist(
        playlistId,
        UpdatePlaylistRequest(name = name, comment = comment, public = public),
    )

    suspend fun deletePlaylist(playlistId: String) {
        apiProvider.requireApi().deletePlaylist(playlistId)
    }

    suspend fun movePlaylist(playlistId: String, folderId: String?) {
        apiProvider.requireApi().movePlaylist(playlistId, MovePlaylistRequest(folderId))
    }

    suspend fun addSongs(playlistId: String, songIds: List<String>) {
        apiProvider.requireApi().addPlaylistSongs(playlistId, AddPlaylistSongsRequest(songIds))
    }

    suspend fun removeSongs(playlistId: String, positions: List<Int>) {
        apiProvider.requireApi().removePlaylistSongs(
            playlistId,
            RemovePlaylistSongsRequest(positions),
        )
    }

    suspend fun moveEntry(playlistId: String, entryId: String, toPosition: Int) {
        apiProvider.requireApi().movePlaylistEntry(
            playlistId,
            MovePlaylistEntryRequest(entryId = entryId, toPosition = toPosition),
        )
    }

    suspend fun reorder(playlistId: String, songIds: List<String>) {
        apiProvider.requireApi().reorderPlaylistSongs(
            playlistId,
            ReorderPlaylistRequest(songIds),
        )
    }

    suspend fun shares(playlistId: String): PlaylistSharesResponse =
        apiProvider.requireApi().playlistShares(playlistId)

    suspend fun setShares(playlistId: String, shares: List<ShareEntry>): PlaylistSharesResponse =
        apiProvider.requireApi().setPlaylistShares(playlistId, SetPlaylistSharesRequest(shares))

    suspend fun transferOwnership(playlistId: String, newOwnerId: Long) {
        apiProvider.requireApi().transferPlaylistOwnership(
            playlistId,
            com.ferrotune.core.network.generated.TransferPlaylistOwnershipRequest(newOwnerId),
        )
    }

    suspend fun membership(songIds: List<String>): PlaylistMembershipResponse =
        apiProvider.requireApi().playlistMembership(PlaylistMembershipRequest(songIds))

    suspend fun smartPlaylists(): SmartPlaylistsResponse =
        apiProvider.requireApi().smartPlaylists()

    suspend fun smartPlaylist(smartPlaylistId: String): SmartPlaylistInfo =
        apiProvider.requireApi().smartPlaylist(smartPlaylistId)

    suspend fun createSmartPlaylist(request: CreateSmartPlaylistRequest): CreateSmartPlaylistResponse =
        apiProvider.requireApi().createSmartPlaylist(request)

    suspend fun updateSmartPlaylist(smartPlaylistId: String, request: UpdateSmartPlaylistRequest) {
        apiProvider.requireApi().updateSmartPlaylist(smartPlaylistId, request)
    }

    suspend fun deleteSmartPlaylist(smartPlaylistId: String) {
        apiProvider.requireApi().deleteSmartPlaylist(smartPlaylistId)
    }

    fun smartPlaylistSongs(
        smartPlaylistId: String,
        filter: String? = null,
        sortField: String? = null,
        sortDirection: String? = null,
    ) = SmartPlaylistSongsPagingSource(
        apiProvider = apiProvider,
        smartPlaylistId = smartPlaylistId,
        filter = filter,
        sortField = sortField,
        sortDirection = sortDirection,
    )

    suspend fun materializeSmartPlaylist(
        smartPlaylistId: String,
        name: String? = null,
        comment: String? = null,
    ): MaterializeSmartPlaylistResponse = apiProvider.requireApi().materializeSmartPlaylist(
        smartPlaylistId,
        MaterializeSmartPlaylistRequest(name = name, comment = comment),
    )

    suspend fun activeServerUrl(): String = apiProvider.requireAccount().serverUrl

    companion object {
        const val PLAYLIST_SORT_CUSTOM = "custom"
    }
}
