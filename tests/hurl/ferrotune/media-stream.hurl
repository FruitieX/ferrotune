# Ferrotune Admin API - Media Streaming Tests
# Tests for stream, cover-art, and download endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /api/stream
# ============================================================================

# First get a song ID
GET {{base_url}}/api/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"

# Stream audio (returns audio content-type)
GET {{base_url}}/api/stream?id={{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "audio"

# Streaming nonexistent song should fail
GET {{base_url}}/api/stream?id=nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# Unauthenticated request should fail
GET {{base_url}}/api/stream?id={{song_id}}
HTTP 401

# An offset transcode is temporary and must not create a completed canonical
# cache entry.
GET {{base_url}}/api/transcode-cache/status?id={{song_id}}&format=opus&maxBitRate=192
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.complete" == false

GET {{base_url}}/api/stream?id={{song_id}}&format=opus&maxBitRate=192&timeOffset=1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" == "audio/ogg"

GET {{base_url}}/api/transcode-cache/status?id={{song_id}}&format=opus&maxBitRate=192
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.complete" == false

# A canonical transcode is persisted and becomes reusable for later seeks.
GET {{base_url}}/api/stream?id={{song_id}}&format=opus&maxBitRate=192
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" == "audio/ogg"

GET {{base_url}}/api/transcode-cache/status?id={{song_id}}&format=opus&maxBitRate=192
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.complete" == true

# ============================================================================
# GET /api/cover-art
# ============================================================================

# Get cover art for the captured song - response depends on whether cover exists
# Just expect a successful response or 404 (no cover)
GET {{base_url}}/api/cover-art?id={{song_id}}
Authorization: Basic {{auth_basic}}
HTTP *

# Unauthenticated request should fail
GET {{base_url}}/api/cover-art?id={{song_id}}
HTTP 401

# ============================================================================
# GET /api/download
# ============================================================================

# Download audio file
GET {{base_url}}/api/download?id={{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "audio"

# Download nonexistent song should fail
GET {{base_url}}/api/download?id=nonexistent-id
Authorization: Basic {{auth_basic}}
HTTP 404

# Unauthenticated request should fail
GET {{base_url}}/api/download?id={{song_id}}
HTTP 401
