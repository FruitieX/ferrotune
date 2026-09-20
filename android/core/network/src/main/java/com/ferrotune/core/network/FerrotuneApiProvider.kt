package com.ferrotune.core.network

import com.ferrotune.core.model.Account

/**
 * Supplies a [FerrotuneApi] for the active account. Extracted so paging
 * sources and repositories can be unit tested with a fake API.
 */
interface FerrotuneApiProvider {
    suspend fun requireApi(): FerrotuneApi

    suspend fun requireAccount(): Account
}
