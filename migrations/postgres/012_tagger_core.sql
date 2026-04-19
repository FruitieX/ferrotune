CREATE TABLE IF NOT EXISTS tagger_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    active_rename_script_id TEXT,
    active_tag_script_id TEXT,
    target_library_id TEXT,
    visible_columns TEXT NOT NULL DEFAULT '["TITLE","ARTIST","ALBUM","ALBUMARTIST","TRACKNUMBER","DISCNUMBER","YEAR","GENRE"]',
    column_widths TEXT NOT NULL DEFAULT '{}',
    file_column_width BIGINT NOT NULL DEFAULT 400,
    show_library_prefix BOOLEAN NOT NULL DEFAULT FALSE,
    show_computed_path BOOLEAN NOT NULL DEFAULT TRUE,
    details_panel_open BOOLEAN NOT NULL DEFAULT TRUE,
    dangerous_char_mode TEXT NOT NULL DEFAULT 'replace',
    dangerous_char_replacement TEXT NOT NULL DEFAULT '_',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tagger_session_tracks (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES tagger_sessions(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    track_type TEXT NOT NULL DEFAULT 'library' CHECK(track_type IN ('library', 'staged')),
    position BIGINT NOT NULL DEFAULT 0,
    UNIQUE(session_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_tagger_session_tracks_session ON tagger_session_tracks(session_id);

CREATE TABLE IF NOT EXISTS tagger_pending_edits (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES tagger_sessions(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    track_type TEXT NOT NULL DEFAULT 'library' CHECK(track_type IN ('library', 'staged')),
    edited_tags TEXT NOT NULL DEFAULT '{}',
    computed_path TEXT,
    cover_art_removed BOOLEAN NOT NULL DEFAULT FALSE,
    cover_art_filename TEXT,
    replacement_audio_filename TEXT DEFAULT NULL,
    replacement_audio_original_name TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_tagger_pending_edits_session ON tagger_pending_edits(session_id);

CREATE TABLE IF NOT EXISTS tagger_scripts (
    id TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('rename', 'tags')),
    script TEXT NOT NULL,
    position BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tagger_scripts_user ON tagger_scripts(user_id);