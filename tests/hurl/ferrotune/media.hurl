# Admin Media API Tests
# Tests administrative media endpoints like song deletion
#
# Test Configuration:
# @requires_fixtures
# @requires_scan
# @copy_fixtures

# ============================================================================
# DELETE SONG FROM DATABASE
# ============================================================================

# Test: Delete non-existent song returns 404
DELETE {{base_url}}/api/songs/nonexistent-song-id
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" exists

# First, get a song ID to work with (from search or browse)
GET {{base_url}}/api/search?query=test&songCount=1
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.searchResult.song[0].id"
song_title: jsonpath "$.searchResult.song[0].title"

# Test: Delete existing song returns success
DELETE {{base_url}}/api/songs/{{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.message" contains "Successfully deleted"

# Test: Trying to delete same song again returns 404
DELETE {{base_url}}/api/songs/{{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" exists

# Test: Song no longer appears in search
GET {{base_url}}/api/songs/{{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" exists
