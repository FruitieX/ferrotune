# Server-Side Queue API Tests
# Tests the new server-authoritative queue management endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# SETUP - Get test data
# ============================================================================

# Get some songs for the queue
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=5
HTTP 200
[Captures]
song_1: jsonpath "$.subsonic-response.randomSongs.song[0].id"
song_2: jsonpath "$.subsonic-response.randomSongs.song[1].id"
song_3: jsonpath "$.subsonic-response.randomSongs.song[2].id"
song_4: jsonpath "$.subsonic-response.randomSongs.song[3].id"
song_5: jsonpath "$.subsonic-response.randomSongs.song[4].id"

# Get an album for source testing
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=newest&size=1
HTTP 200
[Captures]
test_album_id: jsonpath "$.subsonic-response.albumList2.album[0].id"
test_album_name: jsonpath "$.subsonic-response.albumList2.album[0].name"

# Create a playback session (required for all queue operations)
POST {{base_url}}/ferrotune/sessions
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "clientName": "hurl-test"
}
HTTP 200
[Captures]
test_session_id: jsonpath "$.id"

# ============================================================================
# START QUEUE - Create queue from album source
# ============================================================================

# Test: Start queue from album
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "album",
  "sourceId": "{{test_album_id}}",
  "sourceName": "{{test_album_name}}",
  "startIndex": 0,
  "shuffle": false
}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.totalCount" >= 1
jsonpath "$.currentIndex" == 0
jsonpath "$.isShuffled" == false
jsonpath "$.repeatMode" == "off"
jsonpath "$.window.offset" == 0
jsonpath "$.window.songs" count >= 1
jsonpath "$.window.songs[0].position" == 0
jsonpath "$.window.songs[0].song.id" exists
jsonpath "$.window.songs[0].song.title" exists

# ============================================================================
# GET QUEUE - Retrieve queue state
# ============================================================================

# Test: Get queue with default pagination
GET {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" >= 1
jsonpath "$.currentIndex" == 0
jsonpath "$.isShuffled" == false
jsonpath "$.repeatMode" == "off"
jsonpath "$.source.type" == "album"
jsonpath "$.source.id" == "{{test_album_id}}"
jsonpath "$.window.songs" count >= 1

# Test: Get queue with explicit pagination
GET {{base_url}}/ferrotune/queue?offset=0&limit=10&sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.window.offset" == 0

# ============================================================================
# CURRENT WINDOW - Get window around current position
# ============================================================================

# Test: Get current window
GET {{base_url}}/ferrotune/queue/current-window?radius=5&sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" >= 1
jsonpath "$.currentIndex" == 0
jsonpath "$.window.songs" count >= 1

# ============================================================================
# UPDATE POSITION - Change current track
# ============================================================================

# Test: Update position to index 1 (if queue has more than 1 song)
POST {{base_url}}/ferrotune/queue/position
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "currentIndex": 0,
  "positionMs": 5000
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# ============================================================================
# ADD TO QUEUE - Add songs at different positions
# ============================================================================

# Start fresh queue with single song
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "library",
  "startIndex": 0,
  "shuffle": false
}
HTTP 200
[Captures]
initial_count: jsonpath "$.totalCount"

# Test: Add song to end
POST {{base_url}}/ferrotune/queue/add
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "songIds": ["{{song_1}}"],
  "position": "end"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Test: Add song as "next"
POST {{base_url}}/ferrotune/queue/add
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "songIds": ["{{song_2}}"],
  "position": "next"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Test: Add multiple songs at end
POST {{base_url}}/ferrotune/queue/add
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "songIds": ["{{song_3}}", "{{song_4}}"],
  "position": "end"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# ============================================================================
# REMOVE FROM QUEUE - Remove songs
# ============================================================================

# First, start a small test queue
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "album",
  "sourceId": "{{test_album_id}}",
  "startIndex": 0,
  "shuffle": false
}
HTTP 200

# Get current count
GET {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
queue_count_before: jsonpath "$.totalCount"

# Test: Remove song at position 0 (current track can't be removed, will shift to next)
DELETE {{base_url}}/ferrotune/queue/0?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# ============================================================================
# MOVE IN QUEUE - Reorder songs
# ============================================================================

# Start a queue with multiple songs (explicit list to ensure size)
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "library",
  "songIds": ["{{song_1}}", "{{song_2}}", "{{song_3}}"],
  "startIndex": 0,
  "shuffle": false
}
HTTP 200
[Asserts]
jsonpath "$.totalCount" == 3

# Test: Move song from position 1 to position 2 (if queue has 3+ songs)
POST {{base_url}}/ferrotune/queue/move
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "fromPosition": 1,
  "toPosition": 2
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# ============================================================================
# SHUFFLE - Toggle shuffle mode
# ============================================================================

# Start a fresh queue
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "album",
  "sourceId": "{{test_album_id}}",
  "startIndex": 0,
  "shuffle": false
}
HTTP 200
[Asserts]
jsonpath "$.isShuffled" == false

# Test: Enable shuffle
POST {{base_url}}/ferrotune/queue/shuffle
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "enabled": true
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.newIndex" exists

# Verify shuffle is enabled
GET {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.isShuffled" == true

# Test: Disable shuffle
POST {{base_url}}/ferrotune/queue/shuffle
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "enabled": false
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Verify shuffle is disabled
GET {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.isShuffled" == false

# ============================================================================
# REPEAT MODE - Set repeat mode
# ============================================================================

# Test: Set repeat mode to "all"
POST {{base_url}}/ferrotune/queue/repeat
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "mode": "all"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Verify repeat mode
GET {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.repeatMode" == "all"

# Test: Set repeat mode to "one"
POST {{base_url}}/ferrotune/queue/repeat
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "mode": "one"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Test: Set repeat mode back to "off"
POST {{base_url}}/ferrotune/queue/repeat
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "mode": "off"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# ============================================================================
# START WITH SHUFFLE - Create shuffled queue
# ============================================================================

# Test: Start queue with shuffle enabled
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "album",
  "sourceId": "{{test_album_id}}",
  "sourceName": "{{test_album_name}}",
  "startIndex": 0,
  "shuffle": true
}
HTTP 200
[Asserts]
jsonpath "$.isShuffled" == true
jsonpath "$.currentIndex" >= 0

# ============================================================================
# SHUFFLE WITH REORDER - Test that manual reorders are preserved
# ============================================================================

# Start shuffled queue (explicit list to ensure size)
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "library",
  "songIds": ["{{song_1}}", "{{song_2}}", "{{song_3}}"],
  "startIndex": 0,
  "shuffle": true
}
HTTP 200
[Asserts]
jsonpath "$.totalCount" == 3
jsonpath "$.isShuffled" == true

# Move a song in the shuffled queue
POST {{base_url}}/ferrotune/queue/move
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "fromPosition": 1,
  "toPosition": 2
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Verify queue still shuffled after reorder
GET {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.isShuffled" == true

# ============================================================================
# CLEAR QUEUE - Delete entire queue
# ============================================================================

# Test: Clear the queue
DELETE {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.totalCount" == 0

# Verify queue is cleared
GET {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" == 0

# ============================================================================
# EDGE CASES
# ============================================================================

# Test: Start queue from non-existent album
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "album",
  "sourceId": "nonexistent-album-id",
  "startIndex": 0
}
HTTP 404

# Test: Get queue when none exists
GET {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" == 0

# Create a queue for further edge case tests
POST {{base_url}}/ferrotune/queue/start
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "sourceType": "album",
  "sourceId": "{{test_album_id}}",
  "startIndex": 0,
  "shuffle": false
}
HTTP 200

# Test: Position out of range
POST {{base_url}}/ferrotune/queue/position
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "currentIndex": 99999,
  "positionMs": 0
}
HTTP 400

# Test: Invalid repeat mode returns error
POST {{base_url}}/ferrotune/queue/repeat
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "sessionId": "{{test_session_id}}",
  "mode": "invalid"
}
HTTP 400
[Asserts]
jsonpath "$.error" exists

# Clean up - clear queue
DELETE {{base_url}}/ferrotune/queue?sessionId={{test_session_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
