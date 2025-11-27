# Browse API Tests
# Tests browsing endpoints after library scan: getArtists, getArtist, getAlbum, getSong, getGenres
# Prerequisites: Library must be scanned before running these tests
# Fixture data: Test Artist, Another Artist, Various Artists with albums and songs

# ============================================================================
# GET ARTISTS
# ============================================================================

# Test: getArtists (XML) - verify we get artists with required fields
GET {{base_url}}/rest/getArtists?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='artists']" exists
xpath "//*[local-name()='index']" exists
# Verify at least one artist exists with required attributes
xpath "//*[local-name()='artist']/@id" exists
xpath "//*[local-name()='artist']/@name" exists

# Test: getArtists (JSON) - verify structure and capture first artist
GET {{base_url}}/rest/getArtists?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.artists" exists
jsonpath "$.subsonic-response.artists.index" isCollection
# Verify artists have required fields
jsonpath "$.subsonic-response.artists.index[0].artist[0].id" exists
jsonpath "$.subsonic-response.artists.index[0].artist[0].name" exists
jsonpath "$.subsonic-response.artists.index[0].artist[0].albumCount" >= 1
[Captures]
first_artist_id: jsonpath "$.subsonic-response.artists.index[0].artist[0].id"
first_artist_name: jsonpath "$.subsonic-response.artists.index[0].artist[0].name"

# ============================================================================
# GET ARTIST
# ============================================================================

# Test: getArtist - get specific artist details (XML)
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{first_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='artist']/@id)" == "{{first_artist_id}}"
xpath "//*[local-name()='artist']/@name" exists
xpath "//*[local-name()='artist']/@albumCount" exists
xpath "//*[local-name()='artist']/@coverArt" exists
# Verify artist has at least one album
xpath "//*[local-name()='album']" exists
xpath "//*[local-name()='album']/@id" exists
xpath "//*[local-name()='album']/@name" exists
xpath "//*[local-name()='album']/@coverArt" exists

# Test: getArtist - get specific artist details (JSON)
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{first_artist_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.artist.id" == {{first_artist_id}}
jsonpath "$.subsonic-response.artist.name" exists
jsonpath "$.subsonic-response.artist.albumCount" >= 1
jsonpath "$.subsonic-response.artist.coverArt" exists
jsonpath "$.subsonic-response.artist.album" isCollection
# Verify album has required fields
jsonpath "$.subsonic-response.artist.album[0].id" exists
jsonpath "$.subsonic-response.artist.album[0].name" exists
jsonpath "$.subsonic-response.artist.album[0].artist" exists
jsonpath "$.subsonic-response.artist.album[0].coverArt" exists
jsonpath "$.subsonic-response.artist.album[0].songCount" >= 1
[Captures]
first_album_id: jsonpath "$.subsonic-response.artist.album[0].id"
first_album_name: jsonpath "$.subsonic-response.artist.album[0].name"

# Test: getArtist - invalid ID (XML) - server returns 404 Not Found
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id=nonexistent-id
HTTP 404

# Test: getArtist - invalid ID (JSON) - server returns 404 Not Found
GET {{base_url}}/rest/getArtist?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id=nonexistent-id
HTTP 404

# ============================================================================
# GET ALBUM
# ============================================================================

# Test: getAlbum - get album details with songs (XML)
GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{first_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='album']/@id)" == "{{first_album_id}}"
xpath "//*[local-name()='album']/@name" exists
xpath "//*[local-name()='album']/@artist" exists
xpath "//*[local-name()='album']/@artistId" exists
xpath "//*[local-name()='album']/@coverArt" exists
xpath "//*[local-name()='album']/@songCount" exists
xpath "number(//*[local-name()='album']/@duration)" >= 0
# Verify songs exist with required fields
xpath "//*[local-name()='song']" exists
xpath "//*[local-name()='song']/@id" exists
xpath "//*[local-name()='song']/@title" exists
xpath "//*[local-name()='song']/@coverArt" exists
xpath "//*[local-name()='song']/@contentType" exists

# Test: getAlbum - get album details with songs (JSON)
GET {{base_url}}/rest/getAlbum?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{first_album_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.album.id" == {{first_album_id}}
jsonpath "$.subsonic-response.album.name" exists
jsonpath "$.subsonic-response.album.artist" exists
jsonpath "$.subsonic-response.album.artistId" exists
jsonpath "$.subsonic-response.album.coverArt" exists
jsonpath "$.subsonic-response.album.songCount" >= 1
jsonpath "$.subsonic-response.album.duration" >= 0
jsonpath "$.subsonic-response.album.song" isCollection
# Verify song has required fields
jsonpath "$.subsonic-response.album.song[0].id" exists
jsonpath "$.subsonic-response.album.song[0].title" exists
jsonpath "$.subsonic-response.album.song[0].album" exists
jsonpath "$.subsonic-response.album.song[0].albumId" exists
jsonpath "$.subsonic-response.album.song[0].coverArt" exists
jsonpath "$.subsonic-response.album.song[0].duration" >= 0
jsonpath "$.subsonic-response.album.song[0].bitRate" >= 0
jsonpath "$.subsonic-response.album.song[0].contentType" exists
jsonpath "$.subsonic-response.album.song[0].suffix" exists
[Captures]
first_song_id: jsonpath "$.subsonic-response.album.song[0].id"
first_song_title: jsonpath "$.subsonic-response.album.song[0].title"

# ============================================================================
# GET SONG
# ============================================================================

# Test: getSong - get individual song details (XML)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml&id={{first_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='song']/@id)" == "{{first_song_id}}"
xpath "//*[local-name()='song']/@title" exists
xpath "//*[local-name()='song']/@album" exists
xpath "//*[local-name()='song']/@albumId" exists
xpath "//*[local-name()='song']/@coverArt" exists
xpath "number(//*[local-name()='song']/@duration)" >= 0
xpath "number(//*[local-name()='song']/@bitRate)" >= 0
xpath "//*[local-name()='song']/@contentType" exists
xpath "//*[local-name()='song']/@suffix" exists
xpath "//*[local-name()='song']/@path" exists

# Test: getSong - get individual song details (JSON)
GET {{base_url}}/rest/getSong?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&id={{first_song_id}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.song.id" == {{first_song_id}}
jsonpath "$.subsonic-response.song.title" exists
jsonpath "$.subsonic-response.song.album" exists
jsonpath "$.subsonic-response.song.albumId" exists
jsonpath "$.subsonic-response.song.coverArt" exists
jsonpath "$.subsonic-response.song.duration" >= 0
jsonpath "$.subsonic-response.song.bitRate" >= 0
jsonpath "$.subsonic-response.song.contentType" exists
jsonpath "$.subsonic-response.song.suffix" exists
jsonpath "$.subsonic-response.song.path" exists

# ============================================================================
# GET GENRES
# ============================================================================

# Test: getGenres - list all genres (XML) - should have Rock, Electronic, Pop from fixtures
GET {{base_url}}/rest/getGenres?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='genres']" exists
# Should have at least one genre with songCount and albumCount
xpath "//*[local-name()='genre']" exists

# Test: getGenres - list all genres (JSON)
GET {{base_url}}/rest/getGenres?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.genres" exists
jsonpath "$.subsonic-response.genres.genre" isCollection
