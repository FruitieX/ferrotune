# Play Queue API Tests
# Tests play queue endpoints: savePlayQueue, getPlayQueue
# Note: Play queue persistence is not yet fully implemented - these tests verify endpoint parsing works

# ============================================================================
# SETUP - GET SONGS FOR QUEUE
# ============================================================================

# Get some songs for the play queue (JSON for captures)
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=3
HTTP 200
[Captures]
queue_song_1: jsonpath "$.subsonic-response.randomSongs.song[0].id"
queue_song_2: jsonpath "$.subsonic-response.randomSongs.song[1].id"
queue_song_3: jsonpath "$.subsonic-response.randomSongs.song[2].id"

# ============================================================================
# SAVE PLAY QUEUE
# ============================================================================

# Test: savePlayQueue - save a play queue (XML)
GET {{base_url}}/rest/savePlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{queue_song_1}}&id={{queue_song_2}}&id={{queue_song_3}}&current={{queue_song_2}}&position=12345
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: savePlayQueue - save a play queue (JSON)
GET {{base_url}}/rest/savePlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{queue_song_1}}&id={{queue_song_2}}&id={{queue_song_3}}&current={{queue_song_2}}&position=12345
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# Test: savePlayQueue - save same queue again (tests idempotency / no UNIQUE constraint violation)
GET {{base_url}}/rest/savePlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{queue_song_1}}&id={{queue_song_2}}&id={{queue_song_3}}&current={{queue_song_1}}&position=0
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# Test: savePlayQueue - save with different order (tests overwrite works correctly)
GET {{base_url}}/rest/savePlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{queue_song_3}}&id={{queue_song_1}}&current={{queue_song_3}}&position=5000
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# GET PLAY QUEUE
# ============================================================================

# Test: getPlayQueue - retrieve the queue (XML) - returns empty since persistence not implemented
GET {{base_url}}/rest/getPlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='playQueue']" exists

# Test: getPlayQueue - retrieve the queue (JSON) - returns empty since persistence not implemented
GET {{base_url}}/rest/getPlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.playQueue" exists

# ============================================================================
# FERROTUNE ADMIN API - SAVE PLAY QUEUE (POST JSON)
# ============================================================================

# Test: POST /ferrotune/play-queue - save a play queue with JSON body
POST {{base_url}}/ferrotune/play-queue
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{queue_song_1}}", "{{queue_song_2}}", "{{queue_song_3}}"],
  "current": "{{queue_song_2}}",
  "position": 12345
}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.success" == true

# Test: Verify the queue was saved via getPlayQueue
GET {{base_url}}/rest/getPlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.playQueue.entry" count == 3
jsonpath "$.subsonic-response.playQueue.current" == "{{queue_song_2}}"
jsonpath "$.subsonic-response.playQueue.position" == 12345

# Test: POST /ferrotune/play-queue - overwrite with new order
POST {{base_url}}/ferrotune/play-queue
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{queue_song_3}}", "{{queue_song_1}}"],
  "current": "{{queue_song_3}}",
  "position": 5000
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Verify the new order
GET {{base_url}}/rest/getPlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.playQueue.entry" count == 2
jsonpath "$.subsonic-response.playQueue.current" == "{{queue_song_3}}"
jsonpath "$.subsonic-response.playQueue.position" == 5000

# Test: POST /ferrotune/play-queue - save empty queue
POST {{base_url}}/ferrotune/play-queue
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": []
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Verify empty queue
GET {{base_url}}/rest/getPlayQueue?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.playQueue.entry" count == 0
