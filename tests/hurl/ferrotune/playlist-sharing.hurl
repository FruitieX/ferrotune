# Ferrotune Admin API - Playlist Sharing Tests
# Tests for playlist sharing CRUD operations
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# Setup: Create a test user and a playlist to share
# ============================================================================

# Create a user to share playlists with
POST {{base_url}}/api/users
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "username": "share_test_user",
  "password": "sharepass123",
  "isAdmin": false
}
HTTP 201
[Captures]
share_user_id: jsonpath "$.id"
[Asserts]
jsonpath "$.username" == "share_test_user"

# Create a second user
POST {{base_url}}/api/users
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "username": "share_test_user2",
  "password": "sharepass456",
  "isAdmin": false
}
HTTP 201
[Captures]
share_user2_id: jsonpath "$.id"

# Get a song ID for creating a playlist
GET {{base_url}}/api/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.songs[0].id"

# Create a test playlist
POST {{base_url}}/api/playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Shared Playlist Test",
  "comment": "A playlist to test sharing",
  "entries": [
    {
      "songId": "{{song_id}}"
    }
  ]
}
HTTP 200
[Captures]
playlist_id: jsonpath "$.playlistId"

# ============================================================================
# GET /api/users/shareable
# ============================================================================

# List shareable users (should exclude requesting user)
GET {{base_url}}/api/users/shareable
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.users" isCollection
jsonpath "$.users" count >= 2

# Unauthenticated request should fail
GET {{base_url}}/api/users/shareable
HTTP 401

# ============================================================================
# GET /api/playlists/:id/shares (empty initially)
# ============================================================================

# Get shares for the playlist (should be empty)
GET {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.shares" isCollection
jsonpath "$.shares" count == 0

# Unauthenticated request should fail
GET {{base_url}}/api/playlists/{{playlist_id}}/shares
HTTP 401

# ============================================================================
# PUT /api/playlists/:id/shares - Set shares
# ============================================================================

# Share playlist with one user (read-only)
PUT {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "shares": [
    {
      "userId": {{share_user_id}},
      "canEdit": false
    }
  ]
}
HTTP 200
[Asserts]
jsonpath "$.shares" count == 1
jsonpath "$.shares[0].userId" == {{share_user_id}}
jsonpath "$.shares[0].username" == "share_test_user"
jsonpath "$.shares[0].canEdit" == false

# Verify shares via GET
GET {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.shares" count == 1
jsonpath "$.shares[0].userId" == {{share_user_id}}
jsonpath "$.shares[0].canEdit" == false

# ============================================================================
# Update shares: Add second user, change first user permissions
# ============================================================================

PUT {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "shares": [
    {
      "userId": {{share_user_id}},
      "canEdit": true
    },
    {
      "userId": {{share_user2_id}},
      "canEdit": false
    }
  ]
}
HTTP 200
[Asserts]
jsonpath "$.shares" count == 2

# Verify updated shares
GET {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.shares" count == 2

# ============================================================================
# Verify shared playlist appears in shared user's playlist folders
# ============================================================================

# The playlist should now show sharing info in the playlist folders response
GET {{base_url}}/api/playlist-folders
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.playlists" isCollection

# ============================================================================
# Remove shares: set empty array
# ============================================================================

PUT {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "shares": []
}
HTTP 200
[Asserts]
jsonpath "$.shares" count == 0

# Verify shares removed
GET {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.shares" count == 0

# ============================================================================
# Error cases
# ============================================================================

# Try to share with self (should fail)
# First get admin user ID
GET {{base_url}}/api/users/me
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
admin_user_id: jsonpath "$.id"

PUT {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "shares": [
    {
      "userId": {{admin_user_id}},
      "canEdit": false
    }
  ]
}
HTTP 400

# Try to share with nonexistent user
PUT {{base_url}}/api/playlists/{{playlist_id}}/shares
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "shares": [
    {
      "userId": 99999,
      "canEdit": false
    }
  ]
}
HTTP 400

# Try to get shares of nonexistent playlist
GET {{base_url}}/api/playlists/nonexistent-id/shares
Authorization: Basic {{auth_basic}}
HTTP 404

# ============================================================================
# Cleanup
# ============================================================================

# Delete the test playlist
DELETE {{base_url}}/api/playlists/{{playlist_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

# Delete test users (clean up)
DELETE {{base_url}}/api/users/{{share_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

DELETE {{base_url}}/api/users/{{share_user2_id}}
Authorization: Basic {{auth_basic}}
HTTP 204
