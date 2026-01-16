# List API Tests
# Tests list endpoints: getAlbumList2, getRandomSongs, scrobble
# Fixture data: Test Album (Rock, 2024), Another Album (Electronic, 2023), Compilation Album (Pop, 2022)
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET ALBUM LIST 2 - BY NEWEST
# ============================================================================

# Test: getAlbumList2 - by newest (XML) - should return albums with all fields
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&type=newest&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='albumList2']" exists
# Should have at least 3 albums from fixtures
xpath "count(//*[local-name()='album'])" >= 3
xpath "//*[local-name()='album']/@id" exists
xpath "//*[local-name()='album']/@name" exists
xpath "//*[local-name()='album']/@artist" exists
xpath "//*[local-name()='album']/@coverArt" exists

# Test: getAlbumList2 - by newest (JSON) - verify album content
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=newest&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.albumList2" exists
jsonpath "$.subsonic-response.albumList2.album" isCollection
# Should have at least 3 albums
jsonpath "$.subsonic-response.albumList2.album" count >= 3
# First album should have all required fields
jsonpath "$.subsonic-response.albumList2.album[0].id" exists
jsonpath "$.subsonic-response.albumList2.album[0].name" exists
jsonpath "$.subsonic-response.albumList2.album[0].artist" exists
jsonpath "$.subsonic-response.albumList2.album[0].coverArt" exists
jsonpath "$.subsonic-response.albumList2.album[0].songCount" >= 1

# ============================================================================
# GET ALBUM LIST 2 - BY RANDOM
# ============================================================================

# Test: getAlbumList2 - by random (XML) - verify fields present
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&type=random&size=5
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='album']/@coverArt" exists

# Test: getAlbumList2 - by random (JSON)
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=random&size=5
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.albumList2.album[0].coverArt" exists

# ============================================================================
# GET ALBUM LIST 2 - ALPHABETICAL BY NAME
# ============================================================================

# Test: getAlbumList2 - alphabetical by name (XML) - verify albums are sorted
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&type=alphabeticalByName&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
# First album alphabetically should be "Another Album"
xpath "string(//*[local-name()='album'][1]/@name)" == "Another Album"
xpath "//*[local-name()='album']/@coverArt" exists

# Test: getAlbumList2 - alphabetical by name (JSON)
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=alphabeticalByName&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
# Verify first album is Another Album (alphabetically first)
jsonpath "$.subsonic-response.albumList2.album[0].name" == "Another Album"
jsonpath "$.subsonic-response.albumList2.album[0].coverArt" exists

# ============================================================================
# GET ALBUM LIST 2 - BY YEAR (2024)
# ============================================================================

# Test: getAlbumList2 - by year 2024 (XML) - should only return Test Album
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&type=byYear&fromYear=2024&toYear=2024&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "count(//*[local-name()='album'])" >= 1
xpath "count(//*[local-name()='album'][@name='Test Album'])" == 1
xpath "count(//*[local-name()='album'][@name='Test Album' and @artist='Test Artist'])" == 1

# Test: getAlbumList2 - by year 2024 (JSON)
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=byYear&fromYear=2024&toYear=2024&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.albumList2.album" count >= 1
jsonpath "$.subsonic-response.albumList2.album[?(@.name=='Test Album')]" count == 1
jsonpath "$.subsonic-response.albumList2.album[?(@.name=='Test Album')].artist" nth 0 == "Test Artist"
jsonpath "$.subsonic-response.albumList2.album[?(@.name=='Test Album')].year" nth 0 == 2024

# ============================================================================
# GET ALBUM LIST 2 - BY YEAR (2022-2023) - should return at least 2 albums
# ============================================================================

# Test: getAlbumList2 - by year range (JSON)
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=byYear&fromYear=2022&toYear=2023&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.albumList2.album" count >= 2

# ============================================================================
# GET ALBUM LIST 2 - BY GENRE (Rock)
# ============================================================================

# Test: getAlbumList2 - by genre Rock (XML) - should only return Test Album
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&type=byGenre&genre=Rock&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "count(//*[local-name()='album'])" == 1
xpath "string(//*[local-name()='album']/@name)" == "Test Album"
xpath "string(//*[local-name()='album']/@genre)" == "Rock"

# Test: getAlbumList2 - by genre Rock (JSON)
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=byGenre&genre=Rock&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.albumList2.album" count == 1
jsonpath "$.subsonic-response.albumList2.album[0].name" == "Test Album"
jsonpath "$.subsonic-response.albumList2.album[0].genre" == "Rock"

# ============================================================================
# GET ALBUM LIST 2 - BY GENRE (Electronic)
# ============================================================================

# Test: getAlbumList2 - by genre Electronic (JSON) - should only return Another Album
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=byGenre&genre=Electronic&size=10
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.albumList2.album" count == 1
jsonpath "$.subsonic-response.albumList2.album[0].name" == "Another Album"
jsonpath "$.subsonic-response.albumList2.album[0].genre" == "Electronic"

# ============================================================================
# GET RANDOM SONGS
# ============================================================================

# Test: getRandomSongs (XML) - verify song fields
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&size=5
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='randomSongs']" exists
xpath "//*[local-name()='song']/@id" exists
xpath "//*[local-name()='song']/@title" exists
xpath "//*[local-name()='song']/@album" exists
xpath "//*[local-name()='song']/@coverArt" exists

# Test: getRandomSongs (JSON) - verify all required fields
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=5
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.randomSongs" exists
jsonpath "$.subsonic-response.randomSongs.song" isCollection
jsonpath "$.subsonic-response.randomSongs.song[0].id" exists
jsonpath "$.subsonic-response.randomSongs.song[0].title" exists
jsonpath "$.subsonic-response.randomSongs.song[0].album" exists
jsonpath "$.subsonic-response.randomSongs.song[0].albumId" exists
jsonpath "$.subsonic-response.randomSongs.song[0].coverArt" exists
jsonpath "$.subsonic-response.randomSongs.song[0].duration" >= 0
jsonpath "$.subsonic-response.randomSongs.song[0].contentType" exists
[Captures]
scrobble_song_id: jsonpath "$.subsonic-response.randomSongs.song[0].id"

# ============================================================================
# GET RANDOM SONGS - WITH GENRE FILTER (Rock)
# ============================================================================

# Test: getRandomSongs - with genre Rock (XML) - all songs should have Rock genre
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&size=5&genre=Rock
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
# Songs should be from Test Album (Rock genre)
xpath "string(//*[local-name()='song']/@album)" == "Test Album"
xpath "string(//*[local-name()='song']/@genre)" == "Rock"

# Test: getRandomSongs - with genre Rock (JSON)
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=5&genre=Rock
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.randomSongs.song[0].album" == "Test Album"
jsonpath "$.subsonic-response.randomSongs.song[0].genre" == "Rock"

# ============================================================================
# GET RANDOM SONGS - WITH GENRE FILTER (Electronic)  
# ============================================================================

# Test: getRandomSongs - with genre Electronic (JSON) - should be from Another Album
GET {{base_url}}/rest/getRandomSongs?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&size=5&genre=Electronic
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.randomSongs.song[0].album" == "Another Album"
jsonpath "$.subsonic-response.randomSongs.song[0].genre" == "Electronic"

# ============================================================================
# SCROBBLE - NOW PLAYING
# ============================================================================

# Test: scrobble - submit now playing (XML)
GET {{base_url}}/rest/scrobble?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{scrobble_song_id}}&submission=false
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: scrobble - submit now playing (JSON)
GET {{base_url}}/rest/scrobble?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{scrobble_song_id}}&submission=false
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# SCROBBLE - COMPLETED PLAY
# ============================================================================

# Test: scrobble - submit completed play (XML)
GET {{base_url}}/rest/scrobble?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{scrobble_song_id}}&submission=true
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: scrobble - submit completed play (JSON)
GET {{base_url}}/rest/scrobble?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{scrobble_song_id}}&submission=true
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
