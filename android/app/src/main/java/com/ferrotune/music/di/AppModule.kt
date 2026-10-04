package com.ferrotune.music.di

import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.network.AccountSwitcher
import com.ferrotune.core.network.PlaybackSessionResetter
import com.ferrotune.music.accounts.DefaultAccountSwitcher
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class AppModule {
    @Binds
    @Singleton
    abstract fun bindAccountSwitcher(impl: DefaultAccountSwitcher): AccountSwitcher

    @Binds
    @Singleton
    abstract fun bindPlaybackSessionResetter(impl: PlaybackRepository): PlaybackSessionResetter
}
