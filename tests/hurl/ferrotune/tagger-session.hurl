# Ferrotune Admin API - Tagger Session Tests
# Tests for tagger session management endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan
# @copy_fixtures
# @readonly_tags: false

# ============================================================================
# GET /ferrotune/tagger/session
# ============================================================================

# Get session (may be empty initially)
GET {{base_url}}/ferrotune/tagger/session
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.tracks" isCollection

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/tagger/session
HTTP 401

# ============================================================================
# POST /ferrotune/tagger/stage-library
# ============================================================================

# First get song IDs to stage
GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"
song_id_2: jsonpath "$.songs[1].id"

# Stage library tracks - returns tracks array with metadata
POST {{base_url}}/ferrotune/tagger/stage-library
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{song_id}}", "{{song_id_2}}"]
}
HTTP 200
[Asserts]
jsonpath "$.tracks" isCollection

# ============================================================================
# PUT /ferrotune/tagger/session/tracks
# ============================================================================

# Set session tracks (replace all) - requires tracks array with id+trackType
PUT {{base_url}}/ferrotune/tagger/session/tracks
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {"id": "{{song_id}}", "trackType": "library"},
    {"id": "{{song_id_2}}", "trackType": "library"}
  ]
}
HTTP 204

# ============================================================================
# GET /ferrotune/tagger/session (after setting tracks)
# ============================================================================

# Session should now have tracks
GET {{base_url}}/ferrotune/tagger/session
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.tracks" isCollection
jsonpath "$.tracks" count >= 2

# ============================================================================
# POST /ferrotune/tagger/session/tracks
# ============================================================================

# Add more tracks to session (returns 204 No Content)
POST {{base_url}}/ferrotune/tagger/session/tracks
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {"id": "{{song_id}}", "trackType": "library"}
  ]
}
HTTP 204

# ============================================================================
# POST /ferrotune/tagger/session/tracks/remove
# ============================================================================

# Remove tracks from session by IDs
POST {{base_url}}/ferrotune/tagger/session/tracks/remove
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "trackIds": ["{{song_id_2}}"]
}
HTTP 204

# ============================================================================
# DELETE /ferrotune/tagger/session/tracks/:id
# ============================================================================

# Remove track from session
DELETE {{base_url}}/ferrotune/tagger/session/tracks/{{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

# ============================================================================
# PUT /ferrotune/tagger/session/edits/:id
# ============================================================================

# Re-add tracks first
PUT {{base_url}}/ferrotune/tagger/session/tracks
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "tracks": [
    {"id": "{{song_id}}", "trackType": "library"}
  ]
}
HTTP 204

# Create a pending edit for a track
PUT {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "editedTags": {
    "TITLE": "Test Title"
  },
  "computedPath": null,
  "coverArtRemoved": false
}
HTTP 204

# ============================================================================
# GET /ferrotune/tagger/session/edits
# ============================================================================

# Get pending edits - should have the edit we just created
GET {{base_url}}/ferrotune/tagger/session/edits
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.edits" exists
# Check that our specific edit exists and has correct data
# Note: keys in JSON object maps can be accessed via bracket notation
jsonpath "$.edits['{{song_id}}']" exists
jsonpath "$.edits['{{song_id}}'].editedTags.TITLE" == "Test Title"

# ============================================================================
# DELETE /ferrotune/tagger/session/edits/:id
# ============================================================================

# Delete the pending edit for a track
DELETE {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

# Verify edit was deleted
GET {{base_url}}/ferrotune/tagger/session/edits
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.edits" exists
jsonpath "$.edits['{{song_id}}']" not exists

# ============================================================================
# PUT /ferrotune/tagger/session/edits/:id/cover
# ============================================================================

# Upload cover art for a track edit
PUT {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}/cover
Authorization: Basic {{auth_basic}}
[MultipartFormData]
file: file,tests/fixtures/cover.png; image/png
HTTP 200
[Asserts]
jsonpath "$.success" == true

# ============================================================================
# GET /ferrotune/tagger/session/edits/:id/cover
# ============================================================================

# Get the uploaded cover art
GET {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}/cover
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "image/"

# ============================================================================
# DELETE /ferrotune/tagger/session/edits/:id/cover
# ============================================================================

# Remove the cover art edit (revert to original/none)
DELETE {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}/cover
Authorization: Basic {{auth_basic}}
HTTP 204

# Verify cover is gone (should return 404 or default?)
# API usually returns 404 if no custom cover edit exists
GET {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}/cover
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# PUT /ferrotune/tagger/session/edits/:id/replacement-audio
# ============================================================================

# Upload replacement audio
PUT {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}/replacement-audio
Authorization: Basic {{auth_basic}}
[MultipartFormData]
file: file,tests/fixtures/music/simple.mp3; audio/mpeg
HTTP 200
[Asserts]
jsonpath "$.success" == true

# ============================================================================
# GET /ferrotune/tagger/session/edits/:id/replacement-audio/stream
# ============================================================================

# Stream the replacement audio
GET {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}/replacement-audio/stream
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" == "audio/mpeg"

# ============================================================================
# DELETE /ferrotune/tagger/session/edits/:id/replacement-audio
# ============================================================================

# Remove replacement audio
DELETE {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}/replacement-audio
Authorization: Basic {{auth_basic}}
HTTP 204

# ============================================================================
# POST /ferrotune/tagger/session/save
# ============================================================================

# First, setup a valid edit to save (change title)
PUT {{base_url}}/ferrotune/tagger/session/edits/{{song_id}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "editedTags": {
    "TITLE": "Saved Session Title"
  },
  "computedPath": null,
  "coverArtRemoved": false
}
HTTP 204

# Save session (apply edits)
POST {{base_url}}/ferrotune/tagger/session/save
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "trackIds": ["{{song_id}}"]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.savedCount" == 1

# Verify title change via API
GET {{base_url}}/ferrotune/songs/{{song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song.title" == "Saved Session Title"

# ============================================================================
# POST /ferrotune/tagger/session/save-stream
# ============================================================================
# Prepare another edit for save-stream
PUT {{base_url}}/ferrotune/tagger/session/edits/{{song_id_2}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "editedTags": {
    "TITLE": "Stream Saved Title"
  },
  "computedPath": null,
  "coverArtRemoved": false
}
HTTP 204

# Save session with stream output (SSE)
# Note: Hurl doesn't fully support SSE stream verification, but we can check the connection opens
POST {{base_url}}/ferrotune/tagger/session/save-stream
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "trackIds": ["{{song_id_2}}"]
}
HTTP 200
[Asserts]
header "Content-Type" contains "text/event-stream"

# ============================================================================
# DELETE /ferrotune/tagger/session/edits
# ============================================================================

# Clear all pending edits
DELETE {{base_url}}/ferrotune/tagger/session/edits
Authorization: Basic {{auth_basic}}
HTTP 204

# ============================================================================
# PATCH /ferrotune/tagger/session
# ============================================================================

# Update session settings
PATCH {{base_url}}/ferrotune/tagger/session
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "showLibraryPrefix": true,
  "showComputedPath": true,
  "detailsPanelOpen": true
}
HTTP 204

# Verify settings were updated
GET {{base_url}}/ferrotune/tagger/session
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.showLibraryPrefix" == true
jsonpath "$.showComputedPath" == true
jsonpath "$.detailsPanelOpen" == true

# ============================================================================
# GET /ferrotune/tagger/scripts
# ============================================================================

# Get rename scripts
GET {{base_url}}/ferrotune/tagger/scripts
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.scripts" isCollection

# ============================================================================
# PUT /ferrotune/tagger/scripts
# ============================================================================

# Save a custom script (request body is raw array of scripts)
PUT {{base_url}}/ferrotune/tagger/scripts
Authorization: Basic {{auth_basic}}
Content-Type: application/json
[
  {
    "id": "test-script",
    "name": "Test Script",
    "script": "function transform(input) { return input; }",
    "type": "tags"
  }
]
HTTP 204

# Verify script was saved
GET {{base_url}}/ferrotune/tagger/scripts
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.scripts" isCollection
# Verify exact script details
jsonpath "$.scripts[?(@.id == 'test-script')]" count == 1
jsonpath "$.scripts[?(@.id == 'test-script')].name" nth 0 == "Test Script"

# ============================================================================
# DELETE /ferrotune/tagger/scripts/:id
# ============================================================================

# Delete the test script
DELETE {{base_url}}/ferrotune/tagger/scripts/test-script
Authorization: Basic {{auth_basic}}
HTTP 204

# ============================================================================
# DELETE /ferrotune/tagger/session
# ============================================================================

# Clear session
DELETE {{base_url}}/ferrotune/tagger/session
Authorization: Basic {{auth_basic}}
HTTP 204

# Verify session is cleared
GET {{base_url}}/ferrotune/tagger/session
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.tracks" isCollection
jsonpath "$.tracks" count == 0
