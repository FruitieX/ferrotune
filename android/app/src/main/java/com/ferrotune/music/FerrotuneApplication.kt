package com.ferrotune.music

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.ferrotune.core.network.AuthenticatedHttpClientProvider
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class FerrotuneApplication : Application(), SingletonImageLoader.Factory {

    @Inject
    lateinit var httpClientProvider: AuthenticatedHttpClientProvider

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                add(
                    OkHttpNetworkFetcherFactory(
                        callFactory = { httpClientProvider.client },
                    )
                )
            }
            .crossfade(true)
            .build()
}
