# Streaming and Download Tests
# Tests media streaming endpoints: stream, download, getCoverArt
# Prerequisites: Library must be scanned, need a valid song ID
# Fixture data: Test Artist, Another Artist, Various Artists with albums and songs

# ============================================================================
# GET RANDOM SONGS (to get a song ID for streaming)
# ============================================================================

# First, get a song ID to stream (XML) - verify all song fields
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&size=1
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='randomSongs']" exists
xpath "//*[local-name()='song']/@id" exists
xpath "//*[local-name()='song']/@title" exists
xpath "//*[local-name()='song']/@album" exists
xpath "//*[local-name()='song']/@albumId" exists
xpath "//*[local-name()='song']/@coverArt" exists
xpath "//*[local-name()='song']/@contentType" exists
xpath "number(//*[local-name()='song']/@duration)" >= 0
xpath "number(//*[local-name()='song']/@bitRate)" >= 0

# Get song ID to stream (JSON) - captures for later use with full validation
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=1
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.randomSongs" exists
jsonpath "$.subsonic-response.randomSongs.song" isCollection
# Verify song has all required fields
jsonpath "$.subsonic-response.randomSongs.song[0].id" exists
jsonpath "$.subsonic-response.randomSongs.song[0].title" exists
jsonpath "$.subsonic-response.randomSongs.song[0].album" exists
jsonpath "$.subsonic-response.randomSongs.song[0].albumId" exists
jsonpath "$.subsonic-response.randomSongs.song[0].coverArt" exists
jsonpath "$.subsonic-response.randomSongs.song[0].duration" >= 0
jsonpath "$.subsonic-response.randomSongs.song[0].bitRate" >= 0
jsonpath "$.subsonic-response.randomSongs.song[0].contentType" exists
jsonpath "$.subsonic-response.randomSongs.song[0].suffix" exists
jsonpath "$.subsonic-response.randomSongs.song[0].path" exists
[Captures]
stream_song_id: jsonpath "$.subsonic-response.randomSongs.song[0].id"
stream_album_id: jsonpath "$.subsonic-response.randomSongs.song[0].albumId"
stream_song_cover_id: jsonpath "$.subsonic-response.randomSongs.song[0].coverArt"

# ============================================================================
# GET RANDOM SONGS - SIZE PARAMETER
# ============================================================================

# Test: getRandomSongs - multiple songs (XML)
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&size=3
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "count(//*[local-name()='song'])" >= 1

# Test: getRandomSongs - multiple songs (JSON)
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=3
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.randomSongs.song" isCollection

# ============================================================================
# STREAM
# ============================================================================

# Test: stream - stream audio file
GET {{base_url}}/rest/stream?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&id={{stream_song_id}}
HTTP 200
[Asserts]
header "Content-Type" matches "audio/.*"
bytes count > 1000

# Test: stream - invalid song ID (JSON) - error code 70 = not found
GET {{base_url}}/rest/stream?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&id=invalid-id&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 70


# ============================================================================
# DOWNLOAD
# ============================================================================

# Test: download - download audio file
GET {{base_url}}/rest/download?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&id={{stream_song_id}}
HTTP 200
[Asserts]
header "Content-Type" matches "(audio/.*|application/octet-stream)"
bytes count > 1000

# ============================================================================
# GET COVER ART
# ============================================================================

# Test: getCoverArt - get album cover
GET {{base_url}}/rest/getCoverArt?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&id={{stream_song_cover_id}}
HTTP 200
[Asserts]
header "Content-Type" matches "image/.*"
bytes count > 100

# Test: getCoverArt with size parameter
GET {{base_url}}/rest/getCoverArt?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&id={{stream_song_cover_id}}&size=100
HTTP 200
[Asserts]
header "Content-Type" matches "image/.*"

# Test: getCoverArt - invalid ID (JSON) - error code 70 = not found
GET {{base_url}}/rest/getCoverArt?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&id=invalid-cover-id&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 70

