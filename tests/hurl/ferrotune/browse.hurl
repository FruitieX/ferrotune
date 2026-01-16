# Ferrotune Admin API - Browse Endpoints Tests
# Tests for artists, albums, songs, genres, and indexes
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /ferrotune/artists
# ============================================================================

# Get all artists grouped by first letter
GET {{base_url}}/ferrotune/artists
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.artists" exists
jsonpath "$.artists.index" isCollection

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/artists
HTTP 401

# ============================================================================
# GET /ferrotune/artists/:id
# ============================================================================

# First get an artist ID
GET {{base_url}}/ferrotune/artists
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
artist_id: jsonpath "$.artists.index[0].artist[0].id"

# Get artist details
GET {{base_url}}/ferrotune/artists/{{artist_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.artist" exists
jsonpath "$.artist.id" == "{{artist_id}}"
jsonpath "$.artist.name" exists

# Get nonexistent artist
GET {{base_url}}/ferrotune/artists/nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# GET /ferrotune/albums/:id
# ============================================================================

# First get an album ID by getting artist details
GET {{base_url}}/ferrotune/artists/{{artist_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
album_id: jsonpath "$.artist.album[0].id"

# Get album details
GET {{base_url}}/ferrotune/albums/{{album_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" exists
jsonpath "$.album.id" == "{{album_id}}"
jsonpath "$.album.name" exists
jsonpath "$.album.song" isCollection

# Get nonexistent album
GET {{base_url}}/ferrotune/albums/nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# GET /ferrotune/songs/:id
# ============================================================================

# First get a song ID
GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"

# Get song details
GET {{base_url}}/ferrotune/songs/{{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" exists
jsonpath "$.song.id" == "{{song_id}}"
jsonpath "$.song.title" exists

# Get nonexistent song
GET {{base_url}}/ferrotune/songs/nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# GET /ferrotune/genres
# ============================================================================

# Get all genres
GET {{base_url}}/ferrotune/genres
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.genres" isCollection

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/genres
HTTP 401

# ============================================================================
# GET /ferrotune/indexes
# ============================================================================

# Get indexes (artists grouped by letter with folder info)
GET {{base_url}}/ferrotune/indexes
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.indexes" exists
jsonpath "$.indexes.index" isCollection

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/indexes
HTTP 401
