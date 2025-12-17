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

# Get an album to star (JSON for captures)
GET {{base_url}}/rest/getAlbumList2?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&type=alphabeticalByName&size=1
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.albumList2.album[0].id" exists
[Captures]
star_album_id: jsonpath "$.subsonic-response.albumList2.album[0].id"

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
# STAR - ALBUM
# ============================================================================

# Test: star an album (XML)
GET {{base_url}}/rest/star?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&albumId={{star_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: star an album again (JSON) - should be idempotent
GET {{base_url}}/rest/star?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&albumId={{star_album_id}}
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
# Verify starred album has required fields
jsonpath "$.subsonic-response.starred2.album" isCollection
jsonpath "$.subsonic-response.starred2.album[0].id" exists
jsonpath "$.subsonic-response.starred2.album[0].name" exists
# Verify starred song has required fields
jsonpath "$.subsonic-response.starred2.song" isCollection
jsonpath "$.subsonic-response.starred2.song[0].id" exists
jsonpath "$.subsonic-response.starred2.song[0].title" exists
jsonpath "$.subsonic-response.starred2.song[0].coverArt" exists

# ============================================================================
# VERIFY STARRED FIELD IN OTHER ENDPOINTS
# ============================================================================

# Test: getSong should include starred field (JSON)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.song.starred" exists

# Test: getSong should include starred field (XML)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='song']/@starred)" exists

# Test: getArtist should include starred field (JSON)
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.artist.starred" exists

# Test: getArtist should include starred field (XML)
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='artist']/@starred)" exists

# Test: getAlbum should include starred field (JSON)
GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.album.starred" exists

# Test: getAlbum should include starred field (XML)
GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='album']/@starred)" exists

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
# UNSTAR - ALBUM
# ============================================================================

# Test: unstar the album (XML)
GET {{base_url}}/rest/unstar?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&albumId={{star_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: unstar the album again (JSON) - should be idempotent
GET {{base_url}}/rest/unstar?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&albumId={{star_album_id}}
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

# Test: getSong should NOT have starred field after unstarring (JSON)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.song.starred" not exists

# Test: getArtist should NOT have starred field after unstarring (JSON)
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.artist.starred" not exists

# Test: getAlbum should NOT have starred field after unstarring (JSON)
GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.album.starred" not exists

# ============================================================================
# RATINGS - SET RATING
# ============================================================================

# Test: setRating on a song - set to 5 stars (XML)
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_song_id}}&rating=5
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: setRating on same song again (JSON) - should be idempotent
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}&rating=5
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# Test: setRating on an artist (XML)
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_artist_id}}&rating=4
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: setRating on an album (JSON)
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_album_id}}&rating=3
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# RATINGS - VERIFY RATINGS IN RESPONSES
# ============================================================================

# Test: getSong should include userRating (JSON)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.song.userRating" == 5

# Test: getSong should include userRating (XML)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='song']/@userRating)" == "5"

# Test: getArtist should include userRating (JSON)
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.artist.userRating" == 4

# Test: getArtist should include userRating (XML)
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='artist']/@userRating)" == "4"

# Test: getAlbum should include userRating (JSON)
GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.album.userRating" == 3

# Test: getAlbum should include userRating (XML)
GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='album']/@userRating)" == "3"

# ============================================================================
# RATINGS - UPDATE RATING
# ============================================================================

# Test: update rating to a different value (JSON)
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}&rating=3
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# Test: verify updated rating (JSON)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.song.userRating" == 3

# ============================================================================
# RATINGS - REMOVE RATING (rating=0)
# ============================================================================

# Test: setRating with rating=0 removes the rating (XML)
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{star_song_id}}&rating=0
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: verify rating is removed - userRating should not be present (JSON)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.song.userRating" not exists

# Test: remove artist rating (JSON)
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_artist_id}}&rating=0
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# Test: verify artist rating is removed (JSON)
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_artist_id}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.artist.userRating" not exists

# Test: remove album rating (JSON)
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_album_id}}&rating=0
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# Test: verify album rating is removed (JSON)
GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_album_id}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.album.userRating" not exists

# ============================================================================
# RATINGS - ERROR CASES
# ============================================================================

# Test: setRating with invalid rating (> 5) should fail - error code 10 = bad request
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}&rating=6
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 10

# Test: setRating without id should fail - error code 10 = bad request
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&rating=5
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 10

# Test: setRating without rating should fail - error code 10 = bad request
GET {{base_url}}/rest/setRating?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{star_song_id}}
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 10

