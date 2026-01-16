# Ferrotune Disabled Songs Tests
# Tests for disabled songs endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET ALL DISABLED SONGS
# ============================================================================

# Test: Get all disabled songs (initially empty)
GET {{base_url}}/ferrotune/disabled-songs
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songIds" isCollection

# ============================================================================
# GET DISABLED STATUS FOR SONG
# ============================================================================

# First, get a song ID
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=test&songCount=1
HTTP 200
[Captures]
song_id: jsonpath "$.subsonic-response.searchResult3.song[0].id"

# Test: Get disabled status for a song
GET {{base_url}}/ferrotune/songs/{{song_id}}/disabled
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.disabled" isBoolean

# ============================================================================
# SET DISABLED STATUS
# ============================================================================

# Test: Disable a song
PUT {{base_url}}/ferrotune/songs/{{song_id}}/disabled
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "disabled": true
}
HTTP 200
[Asserts]
jsonpath "$.disabled" == true

# Verify it's now in the list
GET {{base_url}}/ferrotune/disabled-songs
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songIds" includes "{{song_id}}"

# Test: Re-enable the song
PUT {{base_url}}/ferrotune/songs/{{song_id}}/disabled
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "disabled": false
}
HTTP 200
[Asserts]
jsonpath "$.disabled" == false

# ============================================================================
# BULK SET DISABLED
# ============================================================================

# Test: Bulk disable songs
POST {{base_url}}/ferrotune/disabled-songs/bulk
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{song_id}}"],
  "disabled": true
}
HTTP 200

# Verify it worked
GET {{base_url}}/ferrotune/songs/{{song_id}}/disabled
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.disabled" == true

# Clean up
POST {{base_url}}/ferrotune/disabled-songs/bulk
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{song_id}}"],
  "disabled": false
}
HTTP 200
