# Tagger API Tests
# Tests the tag editing endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan
# @copy_fixtures
# @readonly_tags: false

# Authenticate
GET {{base_url}}/rest/ping.view?u={{username}}&p={{password}}&v=1.16.1&c=test&f=json
HTTP 200
[Captures]
token: jsonpath "$.subsonic-response.status"
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"

# 1. Get Song ID
GET {{base_url}}/ferrotune/songs/ids
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
first_song_id: jsonpath "$.ids[0]"

# 2. Stage Library Tracks (Metadata retrieval)
POST {{base_url}}/ferrotune/tagger/stage-library
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "songIds": ["{{first_song_id}}"]
}
HTTP 200
[Asserts]
jsonpath "$.tracks" count == 1
# Validation of returned track data
jsonpath "$.tracks[0].id" == "{{first_song_id}}"

# 3. Batch Get Tags
GET {{base_url}}/ferrotune/tagger/batch-tags?songIds={{first_song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.results" count == 1
jsonpath "$.results[0].songId" == "{{first_song_id}}"

# 4. Batch Update Tags
PATCH {{base_url}}/ferrotune/tagger/batch-tags
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "updates": [
        {
            "songId": "{{first_song_id}}",
            "set": [
                { "key": "COMMENT", "value": "Tagger Test" }
            ],
            "delete": []
        }
    ]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.updatedCount" == 1

# 5. Verify update via Batch Get Tags
GET {{base_url}}/ferrotune/tagger/batch-tags?songIds={{first_song_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.results[0].tags.tags[?(@.key=='COMMENT')].value" nth 0 == "Tagger Test"

# 6. Clean up - revert tag
PATCH {{base_url}}/ferrotune/tagger/batch-tags
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "updates": [
        {
            "songId": "{{first_song_id}}",
            "set": [],
            "delete": ["COMMENT"]
        }
    ]
}
HTTP 200

# 7. Test rename files (Success)
POST {{base_url}}/ferrotune/tagger/rename
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "renames": [
        {
            "songId": "{{first_song_id}}",
            "newPath": "renamed_folder/renamed_song.mp3"
        }
    ]
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.renamedCount" == 1
jsonpath "$.errors" count == 0

# 8. Single Song Get Tags
GET {{base_url}}/ferrotune/songs/{{first_song_id}}/tags
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.tags" isCollection

# 9. Single Song Update Tags
PATCH {{base_url}}/ferrotune/songs/{{first_song_id}}/tags
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "set": [
        { "key": "GENRE", "value": "Test Genre" }
    ],
    "delete": []
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Verify
GET {{base_url}}/ferrotune/songs/{{first_song_id}}/tags
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.tags[?(@.key=='GENRE')].value" nth 0 == "Test Genre"

# Cleanup
PATCH {{base_url}}/ferrotune/songs/{{first_song_id}}/tags
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "set": [],
    "delete": ["GENRE"]
}
HTTP 200
