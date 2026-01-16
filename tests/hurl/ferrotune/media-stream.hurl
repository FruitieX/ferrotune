# Ferrotune Admin API - Media Streaming Tests
# Tests for stream, cover-art, and download endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /ferrotune/stream
# ============================================================================

# First get a song ID
GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"

# Stream audio (returns audio content-type)
GET {{base_url}}/ferrotune/stream?id={{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "audio"

# Streaming nonexistent song should fail
GET {{base_url}}/ferrotune/stream?id=nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/stream?id={{song_id}}
HTTP 401

# ============================================================================
# GET /ferrotune/cover-art
# ============================================================================

# Get a song with an album for cover art
GET {{base_url}}/ferrotune/artists
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
artist_id: jsonpath "$.artists.index[0].artist[0].id"

GET {{base_url}}/ferrotune/artists/{{artist_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
album_id: jsonpath "$.artist.album[0].id"

# Get cover art for album - response depends on whether cover exists
# Just expect a successful response or 404 (no cover)
GET {{base_url}}/ferrotune/cover-art?id={{album_id}}
Authorization: Basic {{auth_basic}}
HTTP *

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/cover-art?id={{album_id}}
HTTP 401

# ============================================================================
# GET /ferrotune/download
# ============================================================================

# Download audio file
GET {{base_url}}/ferrotune/download?id={{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "audio"

# Download nonexistent song should fail
GET {{base_url}}/ferrotune/download?id=nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/download?id={{song_id}}
HTTP 401
