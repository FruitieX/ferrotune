# Ferrotune Admin API - Browse Endpoints Tests
# Tests for artists, albums, songs, genres, and indexes
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /api/artists
# ============================================================================

# Get all artists grouped by first letter
GET {{base_url}}/api/artists
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.artists" exists
jsonpath "$.artists.index" isCollection

# Unauthenticated request should fail
GET {{base_url}}/api/artists
HTTP 401

# ============================================================================
# GET /api/artists/:id
# ============================================================================

# First get an artist ID
GET {{base_url}}/api/artists
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
artist_id: jsonpath "$.artists.index[0].artist[0].id"

# Get artist details
GET {{base_url}}/api/artists/{{artist_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.artist" exists
jsonpath "$.artist.id" == "{{artist_id}}"
jsonpath "$.artist.name" exists

# Get nonexistent artist
GET {{base_url}}/api/artists/nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# GET /api/albums/:id
# ============================================================================

# First get an album ID by getting artist details
GET {{base_url}}/api/artists/{{artist_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
album_id: jsonpath "$.artist.album[0].id"

# Get album details
GET {{base_url}}/api/albums/{{album_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" exists
jsonpath "$.album.id" == "{{album_id}}"
jsonpath "$.album.name" exists
jsonpath "$.album.song" isCollection

# Get nonexistent album
GET {{base_url}}/api/albums/nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# GET /api/songs/:id
# ============================================================================

# First get a song ID
GET {{base_url}}/api/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"

# Get song details
GET {{base_url}}/api/songs/{{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" exists
jsonpath "$.song.id" == "{{song_id}}"
jsonpath "$.song.title" exists

# Get nonexistent song
GET {{base_url}}/api/songs/nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# GET /api/genres
# ============================================================================

# Get all genres
GET {{base_url}}/api/genres
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.genres" isCollection

# Unauthenticated request should fail
GET {{base_url}}/api/genres
HTTP 401

# ============================================================================
# GET /api/indexes
# ============================================================================

# Get indexes (artists grouped by letter with folder info)
GET {{base_url}}/api/indexes
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.indexes" exists
jsonpath "$.indexes.index" isCollection

# Unauthenticated request should fail
GET {{base_url}}/api/indexes
HTTP 401
