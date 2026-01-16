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
