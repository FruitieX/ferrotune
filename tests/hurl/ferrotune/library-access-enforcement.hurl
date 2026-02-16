# User-scoped library access enforcement tests
# Verifies library visibility and directory access are scoped by user_library_access
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# SETUP: CREATE LIMITED USER
# ============================================================================

POST {{base_url}}/ferrotune/users
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "username": "limiteduser",
  "password": "limitedpass",
  "isAdmin": false
}
HTTP 201
[Captures]
limited_user_id: jsonpath "$.id"

# Capture an existing library/folder ID (fixture server should have at least one)
GET {{base_url}}/ferrotune/libraries
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
library_id: jsonpath "$.libraries[0].id"

# ============================================================================
# DENY PATH: REMOVE ALL ACCESS
# ============================================================================

PUT {{base_url}}/ferrotune/users/{{limited_user_id}}/library-access
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "folderIds": []
}
HTTP 200
[Asserts]
jsonpath "$.folderIds" isEmpty

# Limited user sees no libraries via Ferrotune API
GET {{base_url}}/ferrotune/libraries
Authorization: Basic bGltaXRlZHVzZXI6bGltaXRlZHBhc3M=
HTTP 200
[Asserts]
jsonpath "$.libraries" isCollection
jsonpath "$.libraries" count == 0

# Limited user cannot browse a specific library directory via Ferrotune API
GET {{base_url}}/ferrotune/directory?libraryId={{library_id}}
Authorization: Basic bGltaXRlZHVzZXI6bGltaXRlZHBhc3M=
HTTP 403

# Limited user sees no music folders via OpenSubsonic API
GET {{base_url}}/rest/getMusicFolders?u=limiteduser&p=limitedpass&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.musicFolders.musicFolder" isCollection
jsonpath "$.subsonic-response.musicFolders.musicFolder" count == 0

# ============================================================================
# ALLOW PATH: GRANT SINGLE FOLDER ACCESS
# ============================================================================

PUT {{base_url}}/ferrotune/users/{{limited_user_id}}/library-access
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "folderIds": [{{library_id}}]
}
HTTP 200
[Asserts]
jsonpath "$.folderIds" count == 1
jsonpath "$.folderIds[0]" == {{library_id}}

# Limited user now sees exactly one library via Ferrotune API
GET {{base_url}}/ferrotune/libraries
Authorization: Basic bGltaXRlZHVzZXI6bGltaXRlZHBhc3M=
HTTP 200
[Asserts]
jsonpath "$.libraries" isCollection
jsonpath "$.libraries" count == 1
jsonpath "$.libraries[0].id" == {{library_id}}

# Limited user now sees exactly one music folder via OpenSubsonic API
GET {{base_url}}/rest/getMusicFolders?u=limiteduser&p=limitedpass&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.musicFolders.musicFolder" isCollection
jsonpath "$.subsonic-response.musicFolders.musicFolder" count == 1
jsonpath "$.subsonic-response.musicFolders.musicFolder[0].id" == {{library_id}}
