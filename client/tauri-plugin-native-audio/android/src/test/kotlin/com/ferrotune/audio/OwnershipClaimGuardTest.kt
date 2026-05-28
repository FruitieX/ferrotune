package com.ferrotune.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OwnershipClaimGuardTest {
    @Test
    fun ignoresNonOwnerSnapshotsDuringRecentLocalClaim() {
        assertTrue(
            OwnershipClaimGuard.shouldIgnoreNonOwnerSnapshot(
                nowElapsedRealtimeMs = 1_500,
                lastLocalClaimElapsedRealtimeMs = 1_000,
                resumePlayback = false,
                graceMs = 10_000,
            ),
        )
    }

    @Test
    fun doesNotIgnoreSnapshotsOutsideClaimGrace() {
        assertFalse(
            OwnershipClaimGuard.shouldIgnoreNonOwnerSnapshot(
                nowElapsedRealtimeMs = 12_001,
                lastLocalClaimElapsedRealtimeMs = 1_000,
                resumePlayback = false,
                graceMs = 10_000,
            ),
        )
    }

    @Test
    fun doesNotIgnoreExplicitResumeOwnershipChanges() {
        assertFalse(
            OwnershipClaimGuard.shouldIgnoreNonOwnerSnapshot(
                nowElapsedRealtimeMs = 1_500,
                lastLocalClaimElapsedRealtimeMs = 1_000,
                resumePlayback = true,
                graceMs = 10_000,
            ),
        )
    }
}