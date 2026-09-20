package com.ferrotune.core.media.di

import com.ferrotune.core.media.PlaybackSessionStarter
import com.ferrotune.core.media.PlaybackStarter
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
}
