# Ferrotune Admin API - Extended Tagger Tests
# Tests for tagger endpoints: Upload, Staged Files, Orphaned Files, Conflict Checking
#
# Test Configuration:
# @requires_fixtures
# @requires_scan
# @copy_fixtures
# @readonly_tags: false

# ============================================================================
# POST /ferrotune/tagger/upload
# ============================================================================

# Upload a real file from fixtures
POST {{base_url}}/ferrotune/tagger/upload
Authorization: Basic {{auth_basic}}
[MultipartFormData]
file: file,tests/fixtures/music/simple.mp3; audio/mpeg
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.errors" count == 0
jsonpath "$.files" count == 1
# Allow original filename to be just the name or partial path depending on upload handling
jsonpath "$.files[0].originalFilename" == "simple.mp3"
jsonpath "$.files[0].tags" isCollection
# Capture the staged file ID (format starts with UUID)
# Capture the staged file ID (format starts with UUID)
[Captures]
staged_file_id: jsonpath "$.files[0].id"

# ============================================================================
# POST /ferrotune/tagger/upload (Second file for cleanup tests)
# ============================================================================

# Upload a second file to test deletion
POST {{base_url}}/ferrotune/tagger/upload
Authorization: Basic {{auth_basic}}
[MultipartFormData]
file: file,tests/fixtures/music/simple.mp3; audio/mpeg
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.files" count == 1
[Captures]
delete_candidate_id: jsonpath "$.files[0].id"

# ============================================================================
# GET /ferrotune/tagger/staged/:id/cover
# ============================================================================

# Get cover art for the staged file (simple.mp3 has embedded cover)
GET {{base_url}}/ferrotune/tagger/staged/{{delete_candidate_id}}/cover
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "image/"

# ============================================================================
# DELETE /ferrotune/tagger/staged/:id
# ============================================================================

# Delete the cleanup candidate
DELETE {{base_url}}/ferrotune/tagger/staged/{{delete_candidate_id}}
Authorization: Basic {{auth_basic}}
HTTP 204
# [Asserts] removed because 204 has no body

# Verify it's gone
GET {{base_url}}/ferrotune/tagger/staged
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.files[?(@.id == '{{delete_candidate_id}}')]" count == 0
# The first file should still be there
jsonpath "$.files[?(@.id == '{{staged_file_id}}')]" count == 1

# ============================================================================
# GET /ferrotune/tagger/staged
# ============================================================================

# Verify the uploaded file appears in staged files
GET {{base_url}}/ferrotune/tagger/staged
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.files" isCollection
# Check if our captured ID exists in the list (using filter)
jsonpath "$.files[?(@.id == '{{staged_file_id}}')]" count == 1

# ============================================================================
# GET /ferrotune/tagger/orphaned
# ============================================================================

# Verify the uploaded file appears as orphaned (not in active session)
GET {{base_url}}/ferrotune/tagger/orphaned
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.fileIds" includes "{{staged_file_id}}"

# ============================================================================
# POST /ferrotune/tagger/check-conflicts
# ============================================================================

# Check for conflict: Rename staged file to an existing library path
# We need to find a valid music folder ID first.

# 1. Get Music Folder ID
GET {{base_url}}/ferrotune/music-folders
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
music_folder_id: jsonpath "$.musicFolders[0].id"

# 2. Check Conflict
# Attempt to rename staged file to match an existing file path known from fixtures
# "Test Artist/Test Album/02 - Second Song.mp3" exists in the processed library struture
POST {{base_url}}/ferrotune/tagger/check-conflicts
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "renames": [
    {
      "songId": "{{staged_file_id}}",
      "newPath": "Test Artist/Test Album/02 - Second Song.mp3",
      "targetMusicFolderId": {{music_folder_id}}
    }
  ]
}
HTTP 200
[Asserts]
jsonpath "$.conflicts" count >= 1
jsonpath "$.conflicts[0].songId" == "{{staged_file_id}}"
# Verify usage of suggested path (usually appends counter)
jsonpath "$.conflicts[0].suggestedPath" != "Test Artist/Test Album/02 - Second Song.mp3"

# ============================================================================
# GET /ferrotune/tagger/staged/:id/stream
# ============================================================================

# Stream the staged file
GET {{base_url}}/ferrotune/tagger/staged/{{staged_file_id}}/stream
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" == "audio/mpeg"
# Check we get some bytes
header "Content-Length" exists

# ============================================================================
# POST /ferrotune/tagger/rescan
# ============================================================================

# Get a song from library to test rescan
GET {{base_url}}/ferrotune/songs/match-list
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
random_song_id: jsonpath "$.songs[0].id"

# Rescan library file
POST {{base_url}}/ferrotune/tagger/rescan
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "songIds": ["{{random_song_id}}"]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.rescannedCount" == 1

# ============================================================================
# POST /ferrotune/tagger/save
# ============================================================================

# Save (Import) the staged file to the library
# This effectively moves it from staging to the music folder
POST {{base_url}}/ferrotune/tagger/save
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "files": [
        {
            "stagedId": "{{staged_file_id}}",
            "targetPath": "Imported/simple.mp3",
            "musicFolderId": {{music_folder_id}}
        }
    ],
    "rescan": false
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.savedCount" == 1
jsonpath "$.newSongIds" count == 1
[Captures]
imported_song_id: jsonpath "$.newSongIds[0]"

# ============================================================================
# Verify Staged Cleanup & Library Import
# ============================================================================

# Verify it's gone from staged list
GET {{base_url}}/ferrotune/tagger/staged
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.files[?(@.id == '{{staged_file_id}}')]" count == 0

# Trigger a library scan to pick up the new file
POST {{base_url}}/ferrotune/scan
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{}
HTTP 202

# Wait for scan to complete using retry (polling)
GET {{base_url}}/ferrotune/scan/status
Authorization: Basic {{auth_basic}}
[Options]
retry: 20
retry-interval: 200ms
HTTP 200
[Asserts]
jsonpath "$.scanning" == false

# Verify "Unique Imported Song" exists
GET {{base_url}}/ferrotune/search?query=Unique%20Imported%20Song
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult.song" count >= 1
jsonpath "$.searchResult.song[0].title" == "Unique Imported Song"
[Captures]
verified_song_id: jsonpath "$.searchResult.song[0].id"

# ============================================================================
# POST /ferrotune/tagger/rename
# ============================================================================

# Rename the imported song
POST {{base_url}}/ferrotune/tagger/rename
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "renames": [
        {
            "songId": "{{verified_song_id}}",
            "newPath": "Renamed/simple_renamed.mp3",
            "targetMusicFolderId": {{music_folder_id}}
        }
    ]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.renamedCount" == 1
jsonpath "$.errors" count == 0
# If failed, print errors (this won't print if success is true, but helps debug)
jsonpath "$.errors[0].error" not exists

# Verify rename by searching (might need scan, but rename usually updates DB immediately in Ferrotune)
GET {{base_url}}/ferrotune/songs/{{verified_song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song.path" contains "Renamed/simple_renamed.mp3"

