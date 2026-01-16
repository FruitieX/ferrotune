# Ferrotune Admin API - Search Endpoint Tests
# Tests for the unified search endpoint
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /ferrotune/search
# ============================================================================

# Search with a query
GET {{base_url}}/ferrotune/search?query=test
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search for artists, albums, and songs
GET {{base_url}}/ferrotune/search?query=artist
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search with limits for each type
GET {{base_url}}/ferrotune/search?query=test&artistCount=5&albumCount=5&songCount=5
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search with offsets for pagination
GET {{base_url}}/ferrotune/search?query=test&artistOffset=0&albumOffset=0&songOffset=0
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search with inline images
GET {{base_url}}/ferrotune/search?query=test&inlineImages=small
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Search returns totals
GET {{base_url}}/ferrotune/search?query=test&artistCount=1&albumCount=1&songCount=1
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Empty query returns empty results
GET {{base_url}}/ferrotune/search?query=
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.searchResult" exists

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/search?query=test
HTTP 401
