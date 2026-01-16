# Ferrotune Admin API - Starring and Rating Tests
# Tests for star, unstar, rating, and get starred endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# Setup - Get IDs for testing
# ============================================================================

# Get a song ID for starring tests
GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"

# Get an artist ID from match list song data
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

# ============================================================================
# POST /ferrotune/star
# ============================================================================

# Star a song
POST {{base_url}}/ferrotune/star
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": ["{{song_id}}"]
}
HTTP 204

# Star an album
POST {{base_url}}/ferrotune/star
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "albumId": ["{{album_id}}"]
}
HTTP 204

# Star an artist
POST {{base_url}}/ferrotune/star
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "artistId": ["{{artist_id}}"]
}
HTTP 204

# Starring with no items is valid (no-op)
POST {{base_url}}/ferrotune/star
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{}
HTTP 204

# Unauthenticated request should fail
POST {{base_url}}/ferrotune/star
Content-Type: application/json
{
  "id": ["test"]
}
HTTP 401

# ============================================================================
# GET /ferrotune/starred
# ============================================================================

# Get all starred items - fields may be omitted if empty (skip_serializing_if)
GET {{base_url}}/ferrotune/starred
Authorization: Basic {{auth_basic}}
HTTP 200

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/starred
HTTP 401

# ============================================================================
# POST /ferrotune/rating
# ============================================================================

# Set rating on a song (1-5)
POST {{base_url}}/ferrotune/rating
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": "{{song_id}}",
  "rating": 5
}
HTTP 204

# Set rating to 0 (removes rating)
POST {{base_url}}/ferrotune/rating
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": "{{song_id}}",
  "rating": 0
}
HTTP 204

# Invalid rating (too high) should fail
POST {{base_url}}/ferrotune/rating
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": "{{song_id}}",
  "rating": 10
}
HTTP 400

# Invalid rating (negative) should fail
POST {{base_url}}/ferrotune/rating
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": "{{song_id}}",
  "rating": -1
}
HTTP 400

# Unauthenticated request should fail
POST {{base_url}}/ferrotune/rating
Content-Type: application/json
{
  "id": "{{song_id}}",
  "rating": 3
}
HTTP 401

# ============================================================================
# POST /ferrotune/unstar
# ============================================================================

# Unstar the song
POST {{base_url}}/ferrotune/unstar
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": ["{{song_id}}"]
}
HTTP 204

# Unstar the album
POST {{base_url}}/ferrotune/unstar
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "albumId": ["{{album_id}}"]
}
HTTP 204

# Unstar the artist
POST {{base_url}}/ferrotune/unstar
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "artistId": ["{{artist_id}}"]
}
HTTP 204

# Unstarring with no items is valid (no-op)
POST {{base_url}}/ferrotune/unstar
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{}
HTTP 204

# Unauthenticated request should fail
POST {{base_url}}/ferrotune/unstar
Content-Type: application/json
{
  "id": ["test"]
}
HTTP 401

# Verify starred returns successfully (items now unstarred)
GET {{base_url}}/ferrotune/starred
Authorization: Basic {{auth_basic}}
HTTP 200
