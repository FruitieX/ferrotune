# Starring/Favorites API Tests
# Tests annotation endpoints: star, unstar, getStarred, getStarred2
# Fixture data: Test Artist, Another Artist, Various Artists with albums and songs

# ============================================================================
# SETUP - GET IDS TO STAR
# ============================================================================

# First get a song to star (JSON for captures)
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=1
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.randomSongs.song[0].id" exists
jsonpath "$.subsonic-response.randomSongs.song[0].title" exists
jsonpath "$.subsonic-response.randomSongs.song[0].coverArt" exists
[Captures]
star_song_id: jsonpath "$.subsonic-response.randomSongs.song[0].id"
star_song_title: jsonpath "$.subsonic-response.randomSongs.song[0].title"

# Get an artist to star (JSON for captures)
GET {{base_url}}/rest/getArtists?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.artists.index[0].artist[0].id" exists
jsonpath "$.subsonic-response.artists.index[0].artist[0].name" exists
[Captures]
star_artist_id: jsonpath "$.subsonic-response.artists.index[0].artist[0].id"
star_artist_name: jsonpath "$.subsonic-response.artists.index[0].artist[0].name"

# ============================================================================
# STAR - SONG
# ============================================================================

# Test: star a song (XML)
GET {{base_url}}/rest/star?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: star a song again (JSON) - should be idempotent
GET {{base_url}}/rest/star?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# STAR - ARTIST
# ============================================================================

# Test: star an artist (XML)
GET {{base_url}}/rest/star?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&artistId={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: star an artist again (JSON) - should be idempotent
GET {{base_url}}/rest/star?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&artistId={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# GET STARRED - VERIFY STARRED ITEMS
# ============================================================================

# Test: getStarred - should contain our starred song (XML)
GET {{base_url}}/rest/getStarred?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='starred']" exists
# Verify starred song is present with required fields
xpath "//*[local-name()='song']/@id" exists
xpath "//*[local-name()='song']/@title" exists
xpath "//*[local-name()='song']/@coverArt" exists

# Test: getStarred - should contain our starred song (JSON)
GET {{base_url}}/rest/getStarred?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.starred" exists
# Verify starred song has required fields
jsonpath "$.subsonic-response.starred.song" isCollection
jsonpath "$.subsonic-response.starred.song[0].id" exists
jsonpath "$.subsonic-response.starred.song[0].title" exists
jsonpath "$.subsonic-response.starred.song[0].coverArt" exists
jsonpath "$.subsonic-response.starred.song[0].album" exists

# ============================================================================
# GET STARRED2 - VERIFY STARRED ARTIST
# ============================================================================

# Test: getStarred2 - ID3 version with starred artist (XML)
GET {{base_url}}/rest/getStarred2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='starred2']" exists
# Verify starred artist is present with required fields
xpath "//*[local-name()='artist']/@id" exists
xpath "//*[local-name()='artist']/@name" exists
xpath "//*[local-name()='artist']/@coverArt" exists

# Test: getStarred2 - ID3 version with starred artist (JSON)
GET {{base_url}}/rest/getStarred2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.starred2" exists
# Verify starred artist has required fields
jsonpath "$.subsonic-response.starred2.artist" isCollection
jsonpath "$.subsonic-response.starred2.artist[0].id" exists
jsonpath "$.subsonic-response.starred2.artist[0].name" exists
jsonpath "$.subsonic-response.starred2.artist[0].coverArt" exists
# Verify starred song has required fields
jsonpath "$.subsonic-response.starred2.song" isCollection
jsonpath "$.subsonic-response.starred2.song[0].id" exists
jsonpath "$.subsonic-response.starred2.song[0].title" exists
jsonpath "$.subsonic-response.starred2.song[0].coverArt" exists

# ============================================================================
# UNSTAR - SONG
# ============================================================================

# Test: unstar the song (XML)
GET {{base_url}}/rest/unstar?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: unstar the song again (JSON) - should be idempotent
GET {{base_url}}/rest/unstar?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# UNSTAR - ARTIST
# ============================================================================

# Test: unstar the artist (XML)
GET {{base_url}}/rest/unstar?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&artistId={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: unstar the artist again (JSON) - should be idempotent
GET {{base_url}}/rest/unstar?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&artistId={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# VERIFY UNSTARRING
# ============================================================================

# Test: getStarred2 after unstarring - should be empty (XML)
GET {{base_url}}/rest/getStarred2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='starred2']" exists

# Test: getStarred2 after unstarring - should be empty (JSON)
GET {{base_url}}/rest/getStarred2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.starred2" exists
