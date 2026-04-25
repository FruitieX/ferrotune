# Ferrotune Managed History Tests
# Tests for raw listening history listing and deletion endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# Setup: Capture a test song and create managed history entries
# ============================================================================

GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"

# Create a listening session that can be deleted by ID
POST {{base_url}}/ferrotune/listening
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songId": "{{song_id}}",
  "durationSeconds": 60
}
HTTP 200
[Captures]
session_id: jsonpath "$.sessionId"
[Asserts]
jsonpath "$.success" == true

# Create a scrobble with a deterministic timestamp that can be captured by filter
POST {{base_url}}/ferrotune/scrobbles
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": "{{song_id}}",
  "time": 1700000000000,
  "submission": true,
  "queueSourceType": "history-manage-test"
}
HTTP 204

# ============================================================================
# GET /ferrotune/history/entries
# ============================================================================

GET {{base_url}}/ferrotune/history/entries?limit=20
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.items" isCollection
jsonpath "$.total" >= 2

# Query only scrobbles in the deterministic timestamp range and capture the ID
GET {{base_url}}/ferrotune/history/entries?includeSessions=false&from=2020-01-01T00%3A00%3A00Z&to=2030-01-01T00%3A00%3A00Z&limit=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
scrobble_id: jsonpath "$.items[0].id"
[Asserts]
jsonpath "$.items[0].kind" == "scrobble"
jsonpath "$.items[0].song.id" == "{{song_id}}"
jsonpath "$.items[0].queueSourceType" == "history-manage-test"
jsonpath "$.total" >= 1

# Duration filters apply to sessions
GET {{base_url}}/ferrotune/history/entries?includeScrobbles=false&minDuration=30&maxDuration=90&limit=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.items[0].kind" == "session"
jsonpath "$.items[0].durationSeconds" == 60
jsonpath "$.total" >= 1

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/history/entries
HTTP 401

# ============================================================================
# POST /ferrotune/history/delete
# ============================================================================

POST {{base_url}}/ferrotune/history/delete
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "scrobbleIds": [{{scrobble_id}}],
  "sessionIds": [{{session_id}}]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.deletedScrobbles" == 1
jsonpath "$.deletedSessions" == 1

# ============================================================================
# POST /ferrotune/history/delete-matching
# ============================================================================

# Create entries that will be deleted by filter
POST {{base_url}}/ferrotune/listening
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songId": "{{song_id}}",
  "durationSeconds": 15
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

POST {{base_url}}/ferrotune/scrobbles
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "id": "{{song_id}}",
  "time": 1700003600000,
  "submission": true,
  "queueSourceType": "history-manage-test"
}
HTTP 204

POST {{base_url}}/ferrotune/history/delete-matching
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "filter": {
    "from": "2020-01-01T00:00:00Z",
    "to": "2030-01-01T00:00:00Z",
    "minDuration": 10,
    "maxDuration": 20
  },
  "kinds": ["scrobble", "session"]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.deletedScrobbles" == 1
jsonpath "$.deletedSessions" == 1

# Unauthorized delete should fail
POST {{base_url}}/ferrotune/history/delete
Content-Type: application/json
{
  "scrobbleIds": [],
  "sessionIds": []
}
HTTP 401
