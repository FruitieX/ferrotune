package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

/** `PUT /api/songs/{id}/disabled`; hand-written because ts-rs does not export it. */
@Serializable
data class SetDisabledRequest(
    val disabled: Boolean,
)
