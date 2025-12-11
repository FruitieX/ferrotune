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

# ============================================================================
# SETUP - Create a playlist for testing
# ============================================================================

# First, get some songs to add to the playlist
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=5
HTTP 200
[Captures]
song_1: jsonpath "$.subsonic-response.randomSongs.song[0].id"
song_2: jsonpath "$.subsonic-response.randomSongs.song[1].id"
song_3: jsonpath "$.subsonic-response.randomSongs.song[2].id"
song_4: jsonpath "$.subsonic-response.randomSongs.song[3].id"
song_5: jsonpath "$.subsonic-response.randomSongs.song[4].id"

# Create a test playlist
GET {{base_url}}/rest/createPlaylist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&name=TestPlaylist&songId={{song_1}}&songId={{song_2}}&songId={{song_3}}&songId={{song_4}}&songId={{song_5}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.playlist.id" exists
[Captures]
test_playlist_id: jsonpath "$.subsonic-response.playlist.id"

# ============================================================================
# FERROTUNE ADMIN API - PLAYLIST SONGS ENDPOINT
# ============================================================================

# Test: Get paginated playlist songs - default parameters
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.id" == "{{test_playlist_id}}"
jsonpath "$.name" == "TestPlaylist"
jsonpath "$.totalEntries" == 5
jsonpath "$.matchedCount" == 5
jsonpath "$.missingCount" == 0
jsonpath "$.filteredCount" == 5
jsonpath "$.entries" count == 5
jsonpath "$.entries[0].position" == 0
jsonpath "$.entries[0].entryType" == "song"
jsonpath "$.entries[0].song.id" exists
jsonpath "$.entries[0].song.title" exists

# Test: Get paginated playlist songs - with offset and count
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?offset=2&count=2
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.entries" count == 2
jsonpath "$.entries[0].position" == 2
jsonpath "$.entries[1].position" == 3
jsonpath "$.filteredCount" == 5

# Test: Get paginated playlist songs - sort by title ascending
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?sort=name&sortDir=asc
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.entries" count == 5
jsonpath "$.filteredCount" == 5

# Test: Get paginated playlist songs - sort by title descending
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?sort=name&sortDir=desc
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.entries" count == 5
jsonpath "$.filteredCount" == 5

# Test: Get paginated playlist songs - filter with matching text
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?filter=test
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.filteredCount" >= 0

# Test: Get paginated playlist songs - filter with non-matching text
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?filter=xyznonexistent123
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.filteredCount" == 0
jsonpath "$.entries" count == 0

# Test: Get paginated playlist songs - custom sort (original playlist order)
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?sort=custom
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.entries[0].position" == 0
jsonpath "$.entries[1].position" == 1
jsonpath "$.entries[2].position" == 2
jsonpath "$.filteredCount" == 5

# Test: Get paginated playlist songs - custom sort descending (reverse order)
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?sort=custom&sortDir=desc
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.entries[0].position" == 4
jsonpath "$.entries[1].position" == 3
jsonpath "$.entries[2].position" == 2
jsonpath "$.filteredCount" == 5

# Test: Get paginated playlist songs - combined pagination and sort
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?offset=1&count=2&sort=name&sortDir=asc
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.entries" count == 2
jsonpath "$.filteredCount" == 5

# Test: Get playlist songs - non-existent playlist returns 404
GET {{base_url}}/ferrotune/playlists/nonexistent-playlist-id-xyz/songs
Authorization: Basic {{auth_basic}}
HTTP 404

# Test: Get playlist songs - filter by entry type "song" (should return only matched songs)
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?entryType=song
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.entries[*].entryType" includes "song"
# All entries should be songs (no missing entries)
jsonpath "$.entries[?(@.entryType == 'missing')]" count == 0

# Test: Get playlist songs - filter by entry type "missing" (should return only missing entries)
GET {{base_url}}/ferrotune/playlists/{{test_playlist_id}}/songs?entryType=missing
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
# Should have 0 missing entries in this test playlist (all songs are matched)
jsonpath "$.entries" count == 0
jsonpath "$.filteredCount" == 0

# ============================================================================
# CLEANUP - Delete test playlist
# ============================================================================

# Delete the test playlist
GET {{base_url}}/rest/deletePlaylist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{test_playlist_id}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
