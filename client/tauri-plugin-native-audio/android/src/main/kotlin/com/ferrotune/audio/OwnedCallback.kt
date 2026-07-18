package com.ferrotune.audio

/**
 * A callback slot whose current owner must release it explicitly.
 *
 * Android can destroy and recreate the Tauri Activity while the playback
 * service remains alive. The replacement plugin must be able to install its
 * WebView callback before the old plugin finishes cleanup without that stale
 * cleanup clearing the replacement callback.
 */
internal class OwnedCallback<A, B> {
    private data class Binding<A, B>(
        val owner: Any,
        val callback: (A, B) -> Unit,
    )

    @Volatile
    private var binding: Binding<A, B>? = null

    @Synchronized
    fun set(owner: Any, callback: (A, B) -> Unit) {
        binding = Binding(owner, callback)
    }

    @Synchronized
    fun clear(owner: Any): Boolean {
        if (binding?.owner !== owner) return false
        binding = null
        return true
    }

    fun emit(first: A, second: B) {
        binding?.callback?.invoke(first, second)
    }
}
