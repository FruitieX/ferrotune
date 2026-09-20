package com.ferrotune.audio

internal object OwnershipClaimGuard {
    fun shouldIgnoreNonOwnerSnapshot(
        nowElapsedRealtimeMs: Long,
        lastLocalClaimElapsedRealtimeMs: Long?,
        resumePlayback: Boolean,
        graceMs: Long,
    ): Boolean {
        if (resumePlayback) return false
        val claimMs = lastLocalClaimElapsedRealtimeMs ?: return false
        if (nowElapsedRealtimeMs < claimMs) return false
        return nowElapsedRealtimeMs - claimMs <= graceMs
    }

    fun shouldReclaimClearedOwnership(
        ownerClientId: String?,
        myClientId: String?,
        wasOwner: Boolean,
        playWhenReady: Boolean,
        isPlaying: Boolean,
    ): Boolean {
        return ownerClientId == null &&
            myClientId != null &&
            wasOwner &&
            (playWhenReady || isPlaying)
    }
}
