CREATE INDEX IF NOT EXISTS idx_artists_search_tsv ON artists USING GIN (
    to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(sort_name, ''))
);

CREATE INDEX IF NOT EXISTS idx_albums_search_name_tsv ON albums USING GIN (
    to_tsvector('simple', COALESCE(name, ''))
);

CREATE INDEX IF NOT EXISTS idx_songs_search_title_tsv ON songs USING GIN (
    to_tsvector('simple', COALESCE(title, ''))
);