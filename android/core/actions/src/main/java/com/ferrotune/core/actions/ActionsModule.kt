package com.ferrotune.core.actions

import com.ferrotune.core.network.AccountScopedPreferences
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet

@Module
@InstallIn(SingletonComponent::class)
abstract class ActionsModule {
    /** Reset on account switch, like the preference caches. */
    @Binds
    @IntoSet
    abstract fun bindDisabledSongs(impl: DisabledSongsStore): AccountScopedPreferences
}
