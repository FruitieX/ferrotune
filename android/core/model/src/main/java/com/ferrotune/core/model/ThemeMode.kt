package com.ferrotune.core.model

/** App-wide light/dark preference, persisted per device. */
enum class ThemeMode {
    SYSTEM,
    LIGHT,
    DARK,
    ;

    companion object {
        /** The web client defaults to its dark theme; so does the native app. */
        val DEFAULT = DARK

        fun fromStorage(value: String?): ThemeMode =
            entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: DEFAULT
    }
}
