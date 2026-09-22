package com.ferrotune.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ferrotune.core.model.ThemeMode
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.uiPreferencesDataStore: DataStore<Preferences> by preferencesDataStore(name = "ferrotune_ui")

/** Device-level theme mode preference, fakeable in tests. */
interface ThemeModeStore {
    val themeMode: Flow<ThemeMode>

    suspend fun setThemeMode(mode: ThemeMode)
}

/** Device-level UI preferences (currently theme mode). */
@Singleton
class ThemePreferencesRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) : ThemeModeStore {
    override val themeMode: Flow<ThemeMode> = context.uiPreferencesDataStore.data.map { preferences ->
        ThemeMode.fromStorage(preferences[THEME_MODE_KEY])
    }

    override suspend fun setThemeMode(mode: ThemeMode) {
        context.uiPreferencesDataStore.edit { preferences ->
            preferences[THEME_MODE_KEY] = mode.name
        }
    }

    private companion object {
        val THEME_MODE_KEY = stringPreferencesKey("theme-mode")
    }
}
