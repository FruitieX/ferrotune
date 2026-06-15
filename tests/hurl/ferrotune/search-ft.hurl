# Ferrotune Admin API - Search Endpoint Tests
# Tests for the unified search endpoint
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /api/search
# ============================================================================

# Search with a query
GET {{base_url}}/api/search?query=test
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search for artists, albums, and songs
GET {{base_url}}/api/search?query=artist
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search with limits for each type
GET {{base_url}}/api/search?query=test&artistCount=5&albumCount=5&songCount=5
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search with offsets for pagination
GET {{base_url}}/api/search?query=test&artistOffset=0&albumOffset=0&songOffset=0
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search with inline images
GET {{base_url}}/api/search?query=test&inlineImages=small
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search returns totals
GET {{base_url}}/api/search?query=test&artistCount=1&albumCount=1&songCount=1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Empty query returns empty results
GET {{base_url}}/api/search?query=
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Fuzzy supplement results are included in songTotal.
# "ong" does not prefix-match any FTS token, but fuzzy LIKE falls back to
# songs such as "First Song", "Second Song" and "Third Song".
GET {{base_url}}/api/search?query=ong&songCount=2
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult.song" count == 2
jsonpath "$.searchResult.songTotal" == 2

# Fuzzy supplement results are included in artistTotal.
# "rtist" does not prefix-match "artist", but fuzzy LIKE falls back to artists.
GET {{base_url}}/api/search?query=rtist&artistCount=2
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult.artist" count == 2
jsonpath "$.searchResult.artistTotal" == 2

# Fuzzy supplement results are included in albumTotal.
# "lbum" does not prefix-match "album", but fuzzy LIKE falls back to albums.
GET {{base_url}}/api/search?query=lbum&albumCount=2
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult.album" count == 2
jsonpath "$.searchResult.albumTotal" == 2

# Unauthenticated request should fail
GET {{base_url}}/api/search?query=test
HTTP 401
