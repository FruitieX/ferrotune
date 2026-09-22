package com.ferrotune.music.di

import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.media.PlaybackSettingsRepository
import com.ferrotune.core.network.AccountScopedPreferences
import com.ferrotune.core.network.AccountSwitcher
import com.ferrotune.core.network.PlaybackSessionResetter
import com.ferrotune.feature.downloads.data.DownloadSettingsRepository
import com.ferrotune.feature.home.data.HomeLayoutPreferencesRepository
import com.ferrotune.feature.library.data.LibraryViewPreferencesRepository
import com.ferrotune.feature.settings.data.AccentSettingsRepository
import com.ferrotune.music.accounts.DefaultAccountSwitcher
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
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

    @Binds
    @IntoSet
    abstract fun bindAccentPreferences(impl: AccentSettingsRepository): AccountScopedPreferences

    @Binds
    @IntoSet
    abstract fun bindPlaybackPreferences(
        impl: PlaybackSettingsRepository,
    ): AccountScopedPreferences

    @Binds
    @IntoSet
    abstract fun bindLibraryPreferences(
        impl: LibraryViewPreferencesRepository,
    ): AccountScopedPreferences

    @Binds
    @IntoSet
    abstract fun bindDownloadPreferences(
        impl: DownloadSettingsRepository,
    ): AccountScopedPreferences

    @Binds
    @IntoSet
    abstract fun bindHomeLayoutPreferences(
        impl: HomeLayoutPreferencesRepository,
    ): AccountScopedPreferences
}
