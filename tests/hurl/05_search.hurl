# Search API Tests
# Tests search endpoints: search3
# Fixture data: Test Artist, Another Artist, Various Artists with albums and songs

# First ensure we have data
GET {{base_url}}/rest/getArtists?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# SEARCH3 - EXACT ARTIST MATCH
# ============================================================================

# Test: search3 - search for "Test Artist" should find exact match (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=Test%20Artist
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='searchResult3']" exists
# Should find Test Artist
xpath "count(//*[local-name()='artist'])" >= 1
xpath "string(//*[local-name()='artist']/@name)" contains "Test Artist"
xpath "//*[local-name()='artist']/@coverArt" exists

# Test: search3 - search for "Test Artist" (JSON) - verify exact name match
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=Test%20Artist
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3" exists
# Should find Test Artist with exact name
jsonpath "$.subsonic-response.searchResult3.artist" isCollection
jsonpath "$.subsonic-response.searchResult3.artist[0].name" == "Test Artist"
jsonpath "$.subsonic-response.searchResult3.artist[0].albumCount" == 1
jsonpath "$.subsonic-response.searchResult3.artist[0].coverArt" exists

# ============================================================================
# SEARCH3 - EXACT ALBUM MATCH  
# ============================================================================

# Test: search3 - search for "Another Album" should find exact match (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=Another%20Album
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
# Should find Another Album with Another Artist
xpath "string(//*[local-name()='album']/@name)" == "Another Album"
xpath "string(//*[local-name()='album']/@artist)" == "Another Artist"
xpath "//*[local-name()='album']/@coverArt" exists

# Test: search3 - search for "Another Album" (JSON)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=Another%20Album
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3.album[0].name" == "Another Album"
jsonpath "$.subsonic-response.searchResult3.album[0].artist" == "Another Artist"
jsonpath "$.subsonic-response.searchResult3.album[0].songCount" == 2
jsonpath "$.subsonic-response.searchResult3.album[0].coverArt" exists

# ============================================================================
# SEARCH3 - EXACT SONG MATCH
# ============================================================================

# Test: search3 - search for "First Song" should find exact match (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=First%20Song
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='song']/@title)" == "First Song"
xpath "string(//*[local-name()='song']/@album)" == "Test Album"
xpath "//*[local-name()='song']/@coverArt" exists

# Test: search3 - search for "First Song" (JSON)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=First%20Song
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3.song[0].title" == "First Song"
jsonpath "$.subsonic-response.searchResult3.song[0].album" == "Test Album"
jsonpath "$.subsonic-response.searchResult3.song[0].coverArt" exists
jsonpath "$.subsonic-response.searchResult3.song[0].contentType" == "audio/mpeg"
jsonpath "$.subsonic-response.searchResult3.song[0].suffix" == "mp3"

# ============================================================================
# SEARCH3 - PARTIAL MATCH "Artist" (should find multiple)
# ============================================================================

# Test: search3 - search for "Artist" should find all artists (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=Artist
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
# Should find multiple artists (Test Artist, Another Artist, Various Artists)
xpath "count(//*[local-name()='artist'])" >= 3
# All artists should have coverArt
xpath "//*[local-name()='artist'][1]/@coverArt" exists

# Test: search3 - search for "Artist" (JSON) - verify multiple results
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=Artist
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
# Should find multiple artists
jsonpath "$.subsonic-response.searchResult3.artist" isCollection
# All artist names should contain "Artist"
jsonpath "$.subsonic-response.searchResult3.artist[0].name" contains "Artist"
jsonpath "$.subsonic-response.searchResult3.artist[0].coverArt" exists
jsonpath "$.subsonic-response.searchResult3.artist[0].albumCount" >= 1

# ============================================================================
# SEARCH3 - PARTIAL MATCH "Album" (should find multiple)
# ============================================================================

# Test: search3 - search for "Album" should find all albums (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=Album
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
# Should find 3 albums (Test Album, Another Album, Compilation Album)
xpath "count(//*[local-name()='album'])" >= 3
xpath "//*[local-name()='album']/@coverArt" exists

# Test: search3 - search for "Album" (JSON)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=Album
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3.album" isCollection
# All album names should contain "Album"
jsonpath "$.subsonic-response.searchResult3.album[0].name" contains "Album"
jsonpath "$.subsonic-response.searchResult3.album[0].coverArt" exists
jsonpath "$.subsonic-response.searchResult3.album[0].songCount" >= 1

# ============================================================================
# SEARCH3 - PARTIAL MATCH "Song" (should find multiple)
# ============================================================================

# Test: search3 - search for "Song" should find songs (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=Song
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
# Should find songs (First Song, Second Song, Third Song, etc.)
xpath "count(//*[local-name()='song'])" >= 3
xpath "//*[local-name()='song']/@coverArt" exists

# Test: search3 - search for "Song" (JSON) - verify songs have all fields
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=Song
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3.song" isCollection
# All song titles should contain "Song"
jsonpath "$.subsonic-response.searchResult3.song[0].title" contains "Song"
jsonpath "$.subsonic-response.searchResult3.song[0].coverArt" exists
jsonpath "$.subsonic-response.searchResult3.song[0].duration" >= 0
jsonpath "$.subsonic-response.searchResult3.song[0].contentType" exists

# ============================================================================
# SEARCH3 - WITH COUNT LIMITS
# ============================================================================

# Test: search3 - with count limits should respect limits (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=Artist&artistCount=1&albumCount=0&songCount=0
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
# Should have exactly 1 artist
xpath "count(//*[local-name()='artist'])" == 1

# Test: search3 - with count limits (JSON)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=Artist&artistCount=2&albumCount=0&songCount=0
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3" exists

# ============================================================================
# SEARCH3 - EMPTY QUERY (returns empty results)
# ============================================================================

# Test: search3 - empty query (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='searchResult3']" exists

# Test: search3 - empty query (JSON)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3" exists

# ============================================================================
# SEARCH3 - NO RESULTS QUERY
# ============================================================================

# Test: search3 - query with no matching results (XML)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&query=zzznomatchzzz
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='searchResult3']" exists
# Should have no results
xpath "count(//*[local-name()='artist'])" == 0
xpath "count(//*[local-name()='album'])" == 0
xpath "count(//*[local-name()='song'])" == 0

# Test: search3 - query with no matching results (JSON)
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=zzznomatchzzz
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3" exists

# ============================================================================
# SEARCH3 - SPECIAL CHARACTERS (FTS5 ESCAPE)
# ============================================================================

# Test: search3 - query with hyphen should not cause SQL error (was: "24-7" -> "no such column: 7")
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=24-7
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3" exists

# Test: search3 - query with special FTS5 operators should be escaped properly
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=test%20OR%20artist
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# Test: search3 - query with double quotes should be escaped
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=test%22quoted%22
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# Test: search3 - query with parentheses
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=(test)
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
