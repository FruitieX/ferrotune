# Playlist API Tests
# Tests playlist endpoints: getPlaylists, createPlaylist (stub), getPlaylist, updatePlaylist, deletePlaylist
# Note: Playlist CRUD is not yet fully implemented - these tests verify endpoint parsing works

# ============================================================================
# GET PLAYLISTS - INITIAL STATE
# ============================================================================

# Test: getPlaylists - initially empty or with existing playlists (XML)
GET {{base_url}}/rest/getPlaylists?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='playlists']" exists

# Test: getPlaylists - initially empty or with existing playlists (JSON)
GET {{base_url}}/rest/getPlaylists?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.playlists" exists
