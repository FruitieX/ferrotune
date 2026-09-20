package com.ferrotune.core.network

/**
 * Supplies a [FerrotuneApi] for the active account. Extracted so paging
 * sources and repositories can be unit tested with a fake API.
 */
interface FerrotuneApiProvider {
    suspend fun requireApi(): FerrotuneApi
}
