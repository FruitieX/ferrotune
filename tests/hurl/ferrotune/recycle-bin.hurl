# Recycle Bin API Tests
# Tests soft delete, restore, and permanent deletion
#
# Test Configuration:
# @requires_fixtures
# @requires_scan
# @copy_fixtures

# ============================================================================
# SETUP
# ============================================================================

# Enable file deletion configuration (required for permanent delete)
PUT {{base_url}}/api/config
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "allowFileDeletion": true
}
HTTP 200
[Asserts]
jsonpath "$.allowFileDeletion" == true

# Get two songs to delete (one for manual delete, one for empty)
GET {{base_url}}/api/songs/random?size=2
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
test_song_id: jsonpath "$.song[0].id"
test_song_id_2: jsonpath "$.song[1].id"

# ============================================================================
# MARK FOR DELETION
# ============================================================================

# Mark song for deletion
POST {{base_url}}/api/recycle-bin/mark
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{test_song_id}}"]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.markedCount" == 1

# Verify song is in recycle bin
GET {{base_url}}/api/recycle-bin
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" >= 1
jsonpath "$.songs[0].id" == "{{test_song_id}}"
jsonpath "$.songs[0].daysRemaining" >= 29

# ============================================================================
# RESTORE
# ============================================================================

# Restore song
POST {{base_url}}/api/recycle-bin/restore
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{test_song_id}}"]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.restoredCount" == 1

# Verify recycle bin is empty (assuming no other songs were deleted)
GET {{base_url}}/api/recycle-bin
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songs" count == 0

# ============================================================================
# PERMANENT DELETE
# ============================================================================

# Mark for deletion again
POST {{base_url}}/api/recycle-bin/mark
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{test_song_id}}"]
}
HTTP 200

# Delete permanently
POST {{base_url}}/api/recycle-bin/delete-permanently
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{test_song_id}}"]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.deletedCount" == 1

# Verify song is gone (check recycle bin)
GET {{base_url}}/api/recycle-bin
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songs" count == 0

# Verify song is gone (check API retrieval)
GET {{base_url}}/api/songs/{{test_song_id}}
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" exists

# ============================================================================
# EMPTY RECYCLE BIN
# ============================================================================

# Mark second song for deletion
POST {{base_url}}/api/recycle-bin/mark
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "songIds": ["{{test_song_id_2}}"]
}
HTTP 200

# Verify it's in bin
GET {{base_url}}/api/recycle-bin
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" == 1

# Empty recycle bin
POST {{base_url}}/api/recycle-bin/empty
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.deletedCount" == 1

# Verify empty
GET {{base_url}}/api/recycle-bin
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.totalCount" == 0
