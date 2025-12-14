# Scrobbles Import API Tests
# Tests for importing play counts from external sources

# ============================================================================
# Setup: Capture test song IDs
# ============================================================================

# Get first song ID for testing
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=random&size=1
HTTP 200
[Captures]
test_album_id: jsonpath "$.subsonic-response.albumList2.album[0].id"

GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{test_album_id}}
HTTP 200
[Captures]
test_song_id: jsonpath "$.subsonic-response.album.song[0].id"
test_song_id_2: jsonpath "$.subsonic-response.album.song[1].id"

# ============================================================================
# POST /ferrotune/scrobbles/import
# ============================================================================

# Test: Import scrobbles in append mode (default)
POST {{base_url}}/ferrotune/scrobbles/import
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "entries": [
    {
      "songId": "{{test_song_id}}",
      "playCount": 5
    }
  ],
  "description": "Test import"
}
HTTP 200
[Asserts]
jsonpath "$.songsImported" == 1
jsonpath "$.totalPlaysImported" == 5

# Test: Import with explicit append mode
POST {{base_url}}/ferrotune/scrobbles/import
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "entries": [
    {
      "songId": "{{test_song_id}}",
      "playCount": 3
    }
  ],
  "mode": "append",
  "description": "Second import"
}
HTTP 200
[Asserts]
jsonpath "$.songsImported" == 1
jsonpath "$.totalPlaysImported" == 3

# Test: Import with replace mode
POST {{base_url}}/ferrotune/scrobbles/import
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "entries": [
    {
      "songId": "{{test_song_id}}",
      "playCount": 10
    }
  ],
  "mode": "replace",
  "description": "Replace import"
}
HTTP 200
[Asserts]
jsonpath "$.songsImported" == 1
jsonpath "$.totalPlaysImported" == 10

# Test: Import empty entries returns success with 0
POST {{base_url}}/ferrotune/scrobbles/import
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "entries": [],
  "mode": "append"
}
HTTP 200
[Asserts]
jsonpath "$.songsImported" == 0
jsonpath "$.totalPlaysImported" == 0

# Test: Import with all invalid song IDs returns error
POST {{base_url}}/ferrotune/scrobbles/import
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "entries": [
    {
      "songId": "nonexistent-song-id-12345",
      "playCount": 5
    }
  ],
  "mode": "append"
}
HTTP 400
[Asserts]
jsonpath "$.error" exists

# Test: Import with multiple songs
POST {{base_url}}/ferrotune/scrobbles/import
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "entries": [
    {
      "songId": "{{test_song_id}}",
      "playCount": 2
    },
    {
      "songId": "{{test_song_id_2}}",
      "playCount": 7
    }
  ],
  "mode": "append",
  "description": "Multi-song import"
}
HTTP 200
[Asserts]
jsonpath "$.songsImported" >= 1
jsonpath "$.totalPlaysImported" >= 2

# Test: Unauthorized request returns 401
POST {{base_url}}/ferrotune/scrobbles/import
Content-Type: application/json
{
  "entries": [],
  "mode": "append"
}
HTTP 401

# ============================================================================
# POST /ferrotune/scrobbles/counts
# ============================================================================

# Test: Get play counts for songs
POST {{base_url}}/ferrotune/scrobbles/counts
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{test_song_id}}"]
}
HTTP 200
[Asserts]
jsonpath "$.counts" isCollection

# Test: Get play counts for empty list
POST {{base_url}}/ferrotune/scrobbles/counts
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": []
}
HTTP 200
[Asserts]
jsonpath "$.counts" isCollection
jsonpath "$.counts" count == 0

# Test: Unauthorized request returns 401
POST {{base_url}}/ferrotune/scrobbles/counts
Content-Type: application/json
{
  "songIds": []
}
HTTP 401
