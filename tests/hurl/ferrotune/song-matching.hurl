# Song Matching API Tests
# Tests server-side fuzzy matching for playlist import
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /ferrotune/songs/match-list (legacy endpoint)
# ============================================================================

# Test: Get match list returns all songs
GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.total" >= 0
jsonpath "$.songs" isCollection

# ============================================================================
# POST /ferrotune/songs/match
# ============================================================================

# Test: Match tracks with exact title match
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": "Test Track",
      "artist": "Test Artist",
      "album": "Test Album",
      "duration": null,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1
jsonpath "$.results[0].score" isFloat

# Test: Match empty tracks returns empty results
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 0

# Test: Match with only title enabled
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": "Test Track",
      "artist": "Test Artist",
      "album": "Test Album",
      "duration": null,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": false,
  "useAlbum": false
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1

# Test: Match with raw string fallback when no structured fields
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": null,
      "artist": null,
      "album": null,
      "duration": null,
      "raw": "Test Track Test Artist"
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1

# Test: Match with no usable search terms returns score 0
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": null,
      "artist": null,
      "album": null,
      "duration": null,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1
jsonpath "$.results[0].score" == 0.0
jsonpath "$.results[0].song" not exists

# Test: Match multiple tracks in batch
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": "Test Track 1",
      "artist": "Artist 1",
      "album": null,
      "duration": null,
      "raw": null
    },
    {
      "title": "Test Track 2",
      "artist": "Artist 2",
      "album": null,
      "duration": null,
      "raw": null
    },
    {
      "title": "NonexistentSong12345",
      "artist": "NonexistentArtist67890",
      "album": null,
      "duration": null,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 3

# Test: Unauthorized request returns 401
POST {{base_url}}/ferrotune/songs/match
Content-Type: application/json
{
  "tracks": [],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 401

# ============================================================================
# REALISTIC MATCHING TESTS (using fixture songs)
# ============================================================================

# Test: Match fixture song with exact title and artist
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": "First Song",
      "artist": "Test Artist",
      "album": "Test Album",
      "duration": null,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1
jsonpath "$.results[0].song" != null
jsonpath "$.results[0].song.title" == "First Song"
jsonpath "$.results[0].song.artist" == "Test Artist"
jsonpath "$.results[0].score" >= 0.9

# Test: Match with extra words (remix, feat, etc) - token-based should handle this
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": "First Song (Remix Extended Version)",
      "artist": "Test Artist feat. Someone",
      "album": null,
      "duration": null,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1
jsonpath "$.results[0].song" != null
# Should still match "First Song" by Test Artist with decent confidence
jsonpath "$.results[0].score" >= 0.5

# Test: Match with slightly different album name
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": "FLAC Track One",
      "artist": "Another Artist",
      "album": "Another Album Deluxe Edition",
      "duration": null,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1
jsonpath "$.results[0].song" != null
jsonpath "$.results[0].song.title" == "FLAC Track One"

# Test: Match using only partial information (title only)
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": "Second Song",
      "artist": null,
      "album": null,
      "duration": null,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1
jsonpath "$.results[0].song" != null
jsonpath "$.results[0].song.title" == "Second Song"

# Test: Duration bonus scoring
POST {{base_url}}/ferrotune/songs/match
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {
      "title": "Third Song",
      "artist": "Test Artist",
      "album": null,
      "duration": 1,
      "raw": null
    }
  ],
  "useTitle": true,
  "useArtist": true,
  "useAlbum": true
}
HTTP 200
[Asserts]
jsonpath "$.results" isCollection
jsonpath "$.results" count == 1
jsonpath "$.results[0].song" != null
# With matching duration, score should get a bonus
jsonpath "$.results[0].score" >= 0.9
