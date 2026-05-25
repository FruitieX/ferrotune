# Ferrotune Shuffle Exclude Tests
# Tests for shuffle exclude endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET ALL SHUFFLE EXCLUDES
# ============================================================================

# Test: Get all shuffle excludes (initially empty)
GET {{base_url}}/api/shuffle-excludes
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songIds" isCollection

# ============================================================================
# GET SHUFFLE EXCLUDE FOR SONG
# ============================================================================

# First, get a song ID
GET {{base_url}}/api/search?query=test&songCount=1
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.searchResult.song[0].id"

# Test: Get shuffle exclude status for a song
GET {{base_url}}/api/songs/{{song_id}}/shuffle-exclude
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.excluded" isBoolean

# ============================================================================
# SET SHUFFLE EXCLUDE
# ============================================================================

# Test: Set shuffle exclude for a song
PUT {{base_url}}/api/songs/{{song_id}}/shuffle-exclude
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "excluded": true
}
HTTP 200
[Asserts]
jsonpath "$.excluded" == true

# Verify it's now in the list
GET {{base_url}}/api/shuffle-excludes
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songIds" includes "{{song_id}}"

# Test: Remove shuffle exclude
PUT {{base_url}}/api/songs/{{song_id}}/shuffle-exclude
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "excluded": false
}
HTTP 200
[Asserts]
jsonpath "$.excluded" == false

# ============================================================================
# BULK SET SHUFFLE EXCLUDES
# ============================================================================

# Test: Bulk set shuffle excludes
POST {{base_url}}/api/shuffle-excludes/bulk
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{song_id}}"],
  "excluded": true
}
HTTP 200

# Verify it worked
GET {{base_url}}/api/songs/{{song_id}}/shuffle-exclude
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.excluded" == true

# Clean up
POST {{base_url}}/api/shuffle-excludes/bulk
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{song_id}}"],
  "excluded": false
}
HTTP 200
