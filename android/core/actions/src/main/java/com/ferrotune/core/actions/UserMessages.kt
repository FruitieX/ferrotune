package com.ferrotune.core.actions

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** One transient confirmation or error, shown as a snackbar by the app shell. */
data class UserMessage(
    val text: String,
    val isError: Boolean = false,
)

/**
 * App-wide feed of short confirmations and errors (the web client's toasts).
 * Actions report outcomes here instead of failing silently; the app shell
 * renders them in one snackbar host above the mini player.
 */
@Singleton
class UserMessages @Inject constructor() {
    private val _messages = MutableSharedFlow<UserMessage>(extraBufferCapacity = 8)
    val messages: SharedFlow<UserMessage> = _messages.asSharedFlow()

    fun show(text: String) {
        _messages.tryEmit(UserMessage(text))
    }

    fun error(text: String) {
        _messages.tryEmit(UserMessage(text, isError = true))
    }

    /** Error message for a failed action, with the server's reason when present. */
    fun failure(action: String, error: Throwable) {
        val reason = error.message?.takeIf { it.isNotBlank() }
        error(if (reason != null) "$action: $reason" else action)
    }
}
