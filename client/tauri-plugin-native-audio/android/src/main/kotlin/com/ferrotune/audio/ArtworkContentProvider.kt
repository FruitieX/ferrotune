package com.ferrotune.audio

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

class ArtworkContentProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String? {
        return if (resolveArtworkFile(uri) != null) ARTWORK_MIME_TYPE else null
    }

    override fun getStreamTypes(uri: Uri, mimeTypeFilter: String): Array<String>? {
        return if (resolveArtworkFile(uri) != null && acceptsMimeType(mimeTypeFilter)) {
            arrayOf(ARTWORK_MIME_TYPE)
        } else {
            null
        }
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Artwork provider is read-only")
        val file = resolveArtworkFile(uri) ?: throw FileNotFoundException("Artwork not found")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun openTypedAssetFile(
        uri: Uri,
        mimeTypeFilter: String,
        opts: Bundle?,
    ): AssetFileDescriptor {
        if (!acceptsMimeType(mimeTypeFilter)) throw FileNotFoundException("Unsupported MIME type")
        return AssetFileDescriptor(openFile(uri, "r"), 0, AssetFileDescriptor.UNKNOWN_LENGTH)
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    private fun resolveArtworkFile(uri: Uri): File? {
        val providerContext = context ?: return null
        val segments = uri.pathSegments
        if (segments.size != 2 || segments[0] != ARTWORK_CACHE_DIR_NAME) return null

        val fileName = segments[1]
        if (!ARTWORK_FILE_NAME_REGEX.matches(fileName)) return null

        val baseDir = File(providerContext.cacheDir, ARTWORK_CACHE_DIR_NAME).canonicalFile
        val file = File(baseDir, fileName).canonicalFile
        if (!file.path.startsWith(baseDir.path + File.separator)) return null

        return file.takeIf { it.isFile }
    }

    private fun acceptsMimeType(mimeTypeFilter: String): Boolean {
        return mimeTypeFilter == "*/*" || mimeTypeFilter == "image/*" || mimeTypeFilter == ARTWORK_MIME_TYPE
    }

    companion object {
        const val ARTWORK_CONTENT_AUTHORITY = "com.ferrotune.audio.artwork"
        const val ARTWORK_CACHE_DIR_NAME = "notification-artwork"
        private const val ARTWORK_MIME_TYPE = "image/jpeg"
        private val ARTWORK_FILE_NAME_REGEX = Regex("[a-f0-9]{64}\\.jpg")
    }
}
