# Ferrotune Admin API - Listening Statistics Tests
# Tests for listening session logging and statistics retrieval
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# POST /ferrotune/listening
# ============================================================================

# First get a song ID to use for listening session
GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"

# Log a new listening session (duration in seconds)
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
jsonpath "$.sessionId" exists
jsonpath "$.success" == true

# Update an existing session (add more time)
POST {{base_url}}/ferrotune/listening
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songId": "{{song_id}}",
  "durationSeconds": 120,
  "sessionId": {{session_id}}
}
HTTP 200
[Asserts]
jsonpath "$.sessionId" == {{session_id}}
jsonpath "$.success" == true

# Log without authentication should fail
POST {{base_url}}/ferrotune/listening
Content-Type: application/json
{
  "songId": "{{song_id}}",
  "durationSeconds": 60
}
HTTP 401

# ============================================================================
# GET /ferrotune/listening/stats
# ============================================================================

# Get listening statistics (uses last7Days, last30Days, thisYear, allTime)
GET {{base_url}}/ferrotune/listening/stats
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.last7Days" exists
jsonpath "$.last7Days.totalSeconds" isInteger
jsonpath "$.last7Days.sessionCount" isInteger
jsonpath "$.last7Days.uniqueSongs" isInteger
jsonpath "$.last30Days" exists
jsonpath "$.last30Days.totalSeconds" isInteger
jsonpath "$.thisYear" exists
jsonpath "$.thisYear.totalSeconds" isInteger
jsonpath "$.allTime" exists
jsonpath "$.allTime.totalSeconds" isInteger

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/listening/stats
HTTP 401

# ============================================================================
# GET /ferrotune/listening/review
# ============================================================================

# Get period review for current year (no periodType param, defaults to year)
GET {{base_url}}/ferrotune/listening/review
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.review" exists
jsonpath "$.review.year" isInteger
jsonpath "$.review.totalListeningSecs" isInteger
jsonpath "$.review.totalPlayCount" isInteger
jsonpath "$.review.uniqueTracks" isInteger
jsonpath "$.review.topArtists" isCollection
jsonpath "$.review.topAlbums" isCollection
jsonpath "$.review.topTracks" isCollection
jsonpath "$.availablePeriods" isCollection

# Get period review with specific year
GET {{base_url}}/ferrotune/listening/review?year=2025
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.review" exists
jsonpath "$.review.year" == 2025

# Get period review with specific month
GET {{base_url}}/ferrotune/listening/review?year=2025&month=1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.review" exists
jsonpath "$.review.year" == 2025
jsonpath "$.review.month" == 1

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/listening/review
HTTP 401
