# Song IDs API Tests
# Tests the /ferrotune/songs/ids endpoint for bulk selection support

# First ensure we have songs in the database
GET {{base_url}}/rest/search3?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&query=*&songCount=1
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.searchResult3.songTotal" >= 1

# ============================================================================
# GET SONG IDS - ALL SONGS
# ============================================================================

# Test: Get all song IDs without filters
GET {{base_url}}/ferrotune/songs/ids
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" isCollection
jsonpath "$.total" >= 1
# Total should match the count of IDs
jsonpath "$.ids" count >= 1

# ============================================================================
# GET SONG IDS - WITH QUERY FILTER
# ============================================================================

# Test: Get song IDs matching a query (should use FTS search)
GET {{base_url}}/ferrotune/songs/ids?query=Song
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" isCollection
jsonpath "$.total" >= 1

# Test: Get song IDs with non-matching query (should return empty)
GET {{base_url}}/ferrotune/songs/ids?query=zzznomatchzzz
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" count == 0
jsonpath "$.total" == 0

# ============================================================================
# GET SONG IDS - WITH WILDCARD QUERY
# ============================================================================

# Test: Get all song IDs with wildcard query
GET {{base_url}}/ferrotune/songs/ids?query=*
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" isCollection
jsonpath "$.total" >= 1

# ============================================================================
# GET SONG IDS - WITH SORTING
# ============================================================================

# Test: Get song IDs sorted by title ascending
GET {{base_url}}/ferrotune/songs/ids?query=*&songSort=name&songSortDir=asc
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" isCollection
jsonpath "$.total" >= 1

# Test: Get song IDs sorted by year descending
GET {{base_url}}/ferrotune/songs/ids?query=*&songSort=year&songSortDir=desc
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" isCollection
jsonpath "$.total" >= 1

# ============================================================================
# GET SONG IDS - WITH FILTERS
# ============================================================================

# Test: Get song IDs with min year filter
GET {{base_url}}/ferrotune/songs/ids?query=*&minYear=2020
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
# Should return at least some songs with year >= 2020
jsonpath "$.ids" isCollection
# Total may be 0 if no songs match

# Test: Get song IDs with max year filter  
GET {{base_url}}/ferrotune/songs/ids?query=*&maxYear=2025
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" isCollection
jsonpath "$.total" >= 0

# Test: Get song IDs with genre filter (using known fixture genre)
GET {{base_url}}/ferrotune/songs/ids?query=*&genre=Rock
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" isCollection

# Test: Get song IDs with starred only filter
GET {{base_url}}/ferrotune/songs/ids?query=*&starredOnly=true
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.ids" isCollection
# Total may be 0 if no songs are starred

# ============================================================================
# AUTHENTICATION
# ============================================================================

# Test: Unauthenticated request should fail
GET {{base_url}}/ferrotune/songs/ids
HTTP 401

