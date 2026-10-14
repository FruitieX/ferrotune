# Song Likes Tests
# Repeatable likes on top of favorites: each tap adds a like, and a tap within
# 12 hours of the newest like undoes it. (Likes adding up across days and the
# window boundary are covered by unit tests in src/db/repo/song_likes.rs.)
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# Setup
# ============================================================================

GET {{base_url}}/api/search?query=*&songCount=2&songSort=name&songSortDir=asc
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_a: jsonpath "$.searchResult.song[0].id"
song_b: jsonpath "$.searchResult.song[1].id"

# Song B is already a favorite before it gets liked
POST {{base_url}}/api/star
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": ["{{song_b}}"]
}
HTTP 204

# ============================================================================
# Toggle
# ============================================================================

# Test: liking song A adds a like and favorites it
POST {{base_url}}/api/songs/{{song_a}}/like
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songId" == "{{song_a}}"
jsonpath "$.liked" == true
jsonpath "$.likeCount" == 1
jsonpath "$.lastLiked" exists
jsonpath "$.starred" exists

# Test: the song carries its like count and newest like
GET {{base_url}}/api/songs/{{song_a}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song.likeCount" == 1
jsonpath "$.song.lastLiked" exists
jsonpath "$.song.starred" exists

# Test: tapping again right away undoes the like, and the favorite it added
POST {{base_url}}/api/songs/{{song_a}}/like
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.liked" == false
jsonpath "$.likeCount" == 0
jsonpath "$.lastLiked" == null
jsonpath "$.starred" == null

GET {{base_url}}/api/songs/{{song_a}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song.likeCount" not exists
jsonpath "$.song.starred" not exists

# Test: a third tap likes it again rather than piling up likes
POST {{base_url}}/api/songs/{{song_a}}/like
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.liked" == true
jsonpath "$.likeCount" == 1

# Test: undoing a like on a song that already was a favorite keeps the favorite
POST {{base_url}}/api/songs/{{song_b}}/like
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.liked" == true
jsonpath "$.likeCount" == 1

POST {{base_url}}/api/songs/{{song_b}}/like
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.liked" == false
jsonpath "$.likeCount" == 0
jsonpath "$.starred" exists

# Test: liking an unknown song is a 404
POST {{base_url}}/api/songs/no-such-song/like
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# Sort and filter
# ============================================================================

# Test: library songs sort by likes, most first
GET {{base_url}}/api/search?query=*&songCount=3&songSort=likes&songSortDir=desc
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult.song[0].id" == "{{song_a}}"
jsonpath "$.searchResult.song[0].likeCount" == 1

# Test: a minimum likes filter keeps only liked songs
GET {{base_url}}/api/search?query=*&songCount=50&minLikes=1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult.song" count == 1
jsonpath "$.searchResult.song[0].id" == "{{song_a}}"

# Test: a smart playlist rule on likes matches only liked songs
POST {{base_url}}/api/smart-playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Liked Songs",
  "isPublic": false,
  "rules": {
    "logic": "and",
    "conditions": [
      {
        "field": "likes",
        "operator": "gte",
        "value": 1
      }
    ]
  },
  "sortField": "likes",
  "sortDirection": "desc"
}
HTTP 201
[Captures]
liked_playlist_id: jsonpath "$.id"

GET {{base_url}}/api/smart-playlists/{{liked_playlist_id}}/songs?offset=0&count=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" == 1
jsonpath "$.songs[0].id" == "{{song_a}}"
jsonpath "$.songs[0].likeCount" == 1

# ============================================================================
# Most liked
# ============================================================================

# Test: the most liked list holds the liked songs, most likes first
GET {{base_url}}/api/songs/most-liked?size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.total" == 1
jsonpath "$.song" count == 1
jsonpath "$.song[0].id" == "{{song_a}}"
jsonpath "$.song[0].likeCount" == 1

# Test: a queue started from Most liked plays the liked songs
POST {{base_url}}/api/sessions
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "clientName": "hurl-test",
  "clientId": "hurl-likes"
}
HTTP 200
[Captures]
session_id: jsonpath "$.id"

POST {{base_url}}/api/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{session_id}}",
  "sourceType": "mostLiked",
  "sourceName": "Most Liked",
  "startIndex": 0,
  "shuffle": false,
  "clientId": "hurl-likes",
  "clientName": "hurl-test"
}
HTTP 200
[Asserts]
jsonpath "$.totalCount" == 1
jsonpath "$.window.songs[0].song.id" == "{{song_a}}"
jsonpath "$.window.songs[0].song.likeCount" == 1
jsonpath "$.window.songs[0].song.lastLiked" exists

# ============================================================================
# Review
# ============================================================================

# Test: the period review counts likes given and the most liked tracks
GET {{base_url}}/api/listening/review
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.review.totalLikes" == 1
jsonpath "$.review.topLikedTracks" count == 1
jsonpath "$.review.topLikedTracks[0].trackId" == "{{song_a}}"
jsonpath "$.review.topLikedTracks[0].likeCount" == 1
