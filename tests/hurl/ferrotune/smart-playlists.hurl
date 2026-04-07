# Smart Playlist API Tests
# Tests CRUD operations and materialization for smart playlists
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# CREATE SMART PLAYLIST
# ============================================================================

# Create a smart playlist matching all songs (playCount >= 0)
POST {{base_url}}/ferrotune/smart-playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Test Smart Playlist",
  "comment": "Created via Hurl",
  "isPublic": false,
  "rules": {
    "logic": "and",
    "conditions": [
      {
        "field": "playCount",
        "operator": "greaterOrEqual",
        "value": 0
      }
    ]
  },
  "sortField": "title",
  "sortDirection": "asc",
  "maxSongs": 50
}
HTTP 201
[Captures]
playlist_id: jsonpath "$.id"
[Asserts]
jsonpath "$.id" exists
jsonpath "$.name" == "Test Smart Playlist"

# ============================================================================
# LIST SMART PLAYLISTS
# ============================================================================

# List all smart playlists
GET {{base_url}}/ferrotune/smart-playlists
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.smartPlaylists" count >= 1
jsonpath "$.smartPlaylists[0].id" exists
jsonpath "$.smartPlaylists[0].rules" exists

# ============================================================================
# GET SINGLE SMART PLAYLIST
# ============================================================================

# Get the created playlist
GET {{base_url}}/ferrotune/smart-playlists/{{playlist_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.id" == "{{playlist_id}}"
jsonpath "$.name" == "Test Smart Playlist"
jsonpath "$.songCount" >= 0

# ============================================================================
# UPDATE SMART PLAYLIST
# ============================================================================

# Update name and rules
PUT {{base_url}}/ferrotune/smart-playlists/{{playlist_id}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Updated Smart Playlist",
  "rules": {
    "logic": "or",
    "conditions": [
      {
        "field": "year",
        "operator": "greaterThan",
        "value": 2000
      }
    ]
  }
}
HTTP 204

# Verify update
GET {{base_url}}/ferrotune/smart-playlists/{{playlist_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.name" == "Updated Smart Playlist"
jsonpath "$.rules.logic" == "or"
jsonpath "$.rules.conditions[0].field" == "year"

# ============================================================================
# GET SONGS
# ============================================================================

# Get songs from the smart playlist
GET {{base_url}}/ferrotune/smart-playlists/{{playlist_id}}/songs?offset=0&count=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.id" == "{{playlist_id}}"
jsonpath "$.totalCount" >= 0
jsonpath "$.songs" isCollection

# ============================================================================
# MATERIALIZE
# ============================================================================

# Materialize into a regular playlist
POST {{base_url}}/ferrotune/smart-playlists/{{playlist_id}}/materialize
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Materialized From Smart"
}
HTTP 201
[Captures]
materialized_id: jsonpath "$.playlistId"
[Asserts]
jsonpath "$.playlistId" exists
jsonpath "$.name" == "Materialized From Smart"
jsonpath "$.songCount" >= 0

# Verify regular playlist was created (using Subsonic API for checking)
GET {{base_url}}/rest/getPlaylist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{materialized_id}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.playlist.id" == "{{materialized_id}}"

# ============================================================================
# DELETE SMART PLAYLIST
# ============================================================================

# Delete the smart playlist
DELETE {{base_url}}/ferrotune/smart-playlists/{{playlist_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

# Verify deletion
GET {{base_url}}/ferrotune/smart-playlists/{{playlist_id}}
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" contains "not found"

# ============================================================================
# IN PLAYLIST (MULTI-SELECT) FILTER
# ============================================================================

# Get a song ID for testing
GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
test_song_id: jsonpath "$.songs[0].id"
test_song_id2: jsonpath "$.songs[1].id"

# Create two playlists and add different songs to each
POST {{base_url}}/ferrotune/playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Smart Test Playlist A",
  "entries": [
    { "songId": "{{test_song_id}}" }
  ]
}
HTTP 200
[Captures]
test_playlist_a_id: jsonpath "$.playlistId"

POST {{base_url}}/ferrotune/playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Smart Test Playlist B",
  "entries": [
    { "songId": "{{test_song_id2}}" }
  ]
}
HTTP 200
[Captures]
test_playlist_b_id: jsonpath "$.playlistId"

# Create smart playlist with multi-select inPlaylist (array of IDs)
POST {{base_url}}/ferrotune/smart-playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Multi-Playlist Filter Test",
  "rules": {
    "logic": "and",
    "conditions": [
      {
        "field": "inPlaylist",
        "operator": "eq",
        "value": ["{{test_playlist_a_id}}", "{{test_playlist_b_id}}"]
      }
    ]
  },
  "sortField": "title",
  "sortDirection": "asc",
  "maxSongs": null
}
HTTP 201
[Captures]
multi_playlist_sp_id: jsonpath "$.id"

# Verify the smart playlist contains songs from both playlists
GET {{base_url}}/ferrotune/smart-playlists/{{multi_playlist_sp_id}}/songs?offset=0&count=100
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" >= 2

# Clean up
DELETE {{base_url}}/ferrotune/smart-playlists/{{multi_playlist_sp_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

# ============================================================================
# IN PLAYLIST FOLDER FILTER
# ============================================================================

# Create a folder
POST {{base_url}}/ferrotune/playlist-folders
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Smart Test Folder"
}
HTTP 200
[Captures]
test_folder_id: jsonpath "$.id"

# Move playlist A into the folder
PATCH {{base_url}}/ferrotune/playlists/{{test_playlist_a_id}}/move
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "folderId": "{{test_folder_id}}"
}
HTTP 204

# Verify move worked by checking playlist info
GET {{base_url}}/ferrotune/playlist-folders
Authorization: Basic {{auth_basic}}
HTTP 200

# Create smart playlist with inPlaylistFolder filter
POST {{base_url}}/ferrotune/smart-playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Folder Filter Test",
  "rules": {
    "logic": "and",
    "conditions": [
      {
        "field": "inPlaylistFolder",
        "operator": "eq",
        "value": "{{test_folder_id}}"
      }
    ]
  },
  "sortField": "title",
  "sortDirection": "asc",
  "maxSongs": null
}
HTTP 201
[Captures]
folder_sp_id: jsonpath "$.id"

# Verify the smart playlist contains songs from the folder's playlists
GET {{base_url}}/ferrotune/smart-playlists/{{folder_sp_id}}/songs?offset=0&count=100
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" >= 1

# Clean up
DELETE {{base_url}}/ferrotune/smart-playlists/{{folder_sp_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

DELETE {{base_url}}/ferrotune/playlists/{{test_playlist_a_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

DELETE {{base_url}}/ferrotune/playlists/{{test_playlist_b_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

DELETE {{base_url}}/ferrotune/playlist-folders/{{test_folder_id}}
Authorization: Basic {{auth_basic}}
HTTP 204
