# Ferrotune API - Discovery Endpoint Tests
# Tests for the discovery/similar-songs endpoint
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /api/discovery/similar-songs
# ============================================================================

# Get similar songs (returns empty if bliss feature is not enabled or no listening history)
GET {{base_url}}/api/discovery/similar-songs?size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.song" isCollection
jsonpath "$.total" exists
jsonpath "$.seed" exists
jsonpath "$.count" == 30
jsonpath "$.excludeRecentDays" == 7
jsonpath "$.seedSongId" exists

# Get similar songs with inline images
GET {{base_url}}/api/discovery/similar-songs?size=5&inlineImages=small
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.song" isCollection
jsonpath "$.count" == 30

# Get similar songs with custom exclude window
GET {{base_url}}/api/discovery/similar-songs?size=10&excludeRecentDays=3
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.song" isCollection
jsonpath "$.excludeRecentDays" == 3
jsonpath "$.count" == 30

# Get similar songs with pagination
GET {{base_url}}/api/discovery/similar-songs?size=5&offset=0
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" isCollection
jsonpath "$.total" exists
jsonpath "$.count" == 30

# Request with an explicit seed echoes the seed back
GET {{base_url}}/api/discovery/similar-songs?size=5&seed=12345
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" isCollection
jsonpath "$.seed" == 12345
jsonpath "$.count" == 30
jsonpath "$.excludeRecentDays" == 7
jsonpath "$.seedSongId" exists

# Passing an explicit seedSongId overrides the scrobble-history lookup.
# When that song has no bliss analysis (or doesn't exist), the endpoint
# returns 404, mirroring the behavior of find_similar_songs.
GET {{base_url}}/api/discovery/similar-songs?size=5&seedSongId=nonexistent-song-id
Authorization: Basic {{auth_basic}}
HTTP 404

# Unauthenticated access should fail
GET {{base_url}}/api/discovery/similar-songs?size=10
HTTP 401
