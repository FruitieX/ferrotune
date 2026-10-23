package com.ferrotune.feature.auth.di

import com.ferrotune.feature.auth.DefaultLoginApis
import com.ferrotune.feature.auth.LastServerStore
import com.ferrotune.feature.auth.LoginApis
import com.ferrotune.feature.auth.PendingOidcLoginStore
import com.ferrotune.feature.auth.SharedPrefsLastServerStore
import com.ferrotune.feature.auth.SharedPrefsPendingOidcLoginStore
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class OidcModule {
    @Binds
    abstract fun pendingOidcLoginStore(impl: SharedPrefsPendingOidcLoginStore): PendingOidcLoginStore

    @Binds
    abstract fun lastServerStore(impl: SharedPrefsLastServerStore): LastServerStore

    @Binds
    abstract fun loginApis(impl: DefaultLoginApis): LoginApis
}
