# Ferrotune API - Discovery Endpoint Tests
# Tests for the discovery/similar-songs endpoint
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /api/discovery/similar-songs
# ============================================================================

# Get similar songs (returns empty if bliss feature is not enabled or no listening history)
GET {{base_url}}/api/discovery/similar-songs?size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.song" isCollection
jsonpath "$.total" exists

# Get similar songs with inline images
GET {{base_url}}/api/discovery/similar-songs?size=5&inlineImages=small
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.song" isCollection

# Get similar songs with custom exclude window
GET {{base_url}}/api/discovery/similar-songs?size=10&excludeRecentDays=3
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.song" isCollection

# Get similar songs with pagination
GET {{base_url}}/api/discovery/similar-songs?size=5&offset=0
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" isCollection
jsonpath "$.total" exists

# Unauthenticated access should fail
GET {{base_url}}/api/discovery/similar-songs?size=10
HTTP 401
