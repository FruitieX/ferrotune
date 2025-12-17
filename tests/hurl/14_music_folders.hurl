# Music Folder Management API Tests
# Tests the /ferrotune/music-folders endpoints

# ============================================================================
# LIST MUSIC FOLDERS
# ============================================================================

# Test: Get music folders returns valid response structure
GET {{base_url}}/ferrotune/music-folders
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.musicFolders" isCollection

# ============================================================================
# GET SINGLE MUSIC FOLDER
# ============================================================================

# Test: Get first music folder (should exist from test setup)
GET {{base_url}}/ferrotune/music-folders/1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.id" == 1
jsonpath "$.name" isString
jsonpath "$.path" isString
jsonpath "$.enabled" isBoolean
jsonpath "$.stats.songCount" isInteger
jsonpath "$.stats.albumCount" isInteger
jsonpath "$.stats.artistCount" isInteger
jsonpath "$.stats.totalDurationSeconds" isInteger
jsonpath "$.stats.totalSizeBytes" isInteger

# Test: Get non-existent music folder returns error
GET {{base_url}}/ferrotune/music-folders/9999
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 70

# ============================================================================
# UPDATE MUSIC FOLDER
# ============================================================================

# Test: Disable a music folder
PATCH {{base_url}}/ferrotune/music-folders/1
Authorization: Basic {{auth_basic}}
Content-Type: application/json
```json
{
  "enabled": false
}
```
HTTP 200

# Verify folder is now disabled
GET {{base_url}}/ferrotune/music-folders/1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.enabled" == false

# Test: Re-enable the music folder
PATCH {{base_url}}/ferrotune/music-folders/1
Authorization: Basic {{auth_basic}}
Content-Type: application/json
```json
{
  "enabled": true
}
```
HTTP 200

# Verify folder is now enabled
GET {{base_url}}/ferrotune/music-folders/1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.enabled" == true

# Test: Update music folder name
PATCH {{base_url}}/ferrotune/music-folders/1
Authorization: Basic {{auth_basic}}
Content-Type: application/json
```json
{
  "name": "Renamed Folder"
}
```
HTTP 200

# Verify name was updated
GET {{base_url}}/ferrotune/music-folders/1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.name" == "Renamed Folder"

# ============================================================================
# CREATE MUSIC FOLDER - Error Cases
# ============================================================================

# Test: Create with non-existent path fails
POST {{base_url}}/ferrotune/music-folders
Authorization: Basic {{auth_basic}}
Content-Type: application/json
```json
{
  "name": "Invalid Folder",
  "path": "/nonexistent/path/that/does/not/exist"
}
```
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 10

# ============================================================================
# DELETE MUSIC FOLDER - Error Cases
# ============================================================================

# Test: Delete non-existent folder returns error
DELETE {{base_url}}/ferrotune/music-folders/9999
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 70

# ============================================================================
# STATS ENDPOINT
# ============================================================================

# Test: Get stats for first music folder
GET {{base_url}}/ferrotune/music-folders/1/stats
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songCount" isInteger
jsonpath "$.albumCount" isInteger
jsonpath "$.artistCount" isInteger
jsonpath "$.totalDurationSeconds" isInteger
jsonpath "$.totalSizeBytes" isInteger

# Test: Get stats for non-existent folder returns error
GET {{base_url}}/ferrotune/music-folders/9999/stats
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 70
