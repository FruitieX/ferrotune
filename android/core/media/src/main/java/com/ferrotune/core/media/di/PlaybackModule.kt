package com.ferrotune.core.media.di

import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.media.PlaybackSessionStarter
import com.ferrotune.core.media.PlaybackSettingsApplier
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.cast.CastHandoffPlayback
import com.ferrotune.core.media.cast.CastManager
import com.ferrotune.core.media.cast.CastSessionPort
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class PlaybackModule {
    @Binds
    @Singleton
    abstract fun bindPlaybackStarter(impl: PlaybackSessionStarter): PlaybackStarter

    @Binds
    @Singleton
    abstract fun bindCastHandoffPlayback(impl: PlaybackSessionStarter): CastHandoffPlayback

    @Binds
    @Singleton
    abstract fun bindCastSessionPort(impl: CastManager): CastSessionPort

    @Binds
    @Singleton
    abstract fun bindPlaybackSettingsApplier(impl: PlaybackRepository): PlaybackSettingsApplier
}
