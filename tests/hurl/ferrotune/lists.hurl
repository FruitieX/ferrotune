# Ferrotune Admin API - List Endpoints Tests
# Tests for album lists, random songs, songs by genre
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET /ferrotune/albums (Album List)
# ============================================================================

# Get recent albums
GET {{base_url}}/ferrotune/albums?type=newest&size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" isCollection

# Get alphabetically sorted albums
GET {{base_url}}/ferrotune/albums?type=alphabeticalByName&size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" isCollection

# Get frequently played albums
GET {{base_url}}/ferrotune/albums?type=frequent&size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" isCollection

# Get recently played albums
GET {{base_url}}/ferrotune/albums?type=recent&size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" isCollection

# Get random albums
GET {{base_url}}/ferrotune/albums?type=random&size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" isCollection

# Get starred albums
GET {{base_url}}/ferrotune/albums?type=starred&size=10
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" isCollection

# Get albums with offset pagination
GET {{base_url}}/ferrotune/albums?type=newest&size=5&offset=0
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.album" isCollection

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/albums?type=newest
HTTP 401

# ============================================================================
# GET /ferrotune/songs/random
# ============================================================================

# Get random songs with default size
GET {{base_url}}/ferrotune/songs/random
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" isCollection

# Get random songs with specific size
GET {{base_url}}/ferrotune/songs/random?size=5
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" isCollection

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/songs/random
HTTP 401

# ============================================================================
# GET /ferrotune/songs/by-genre
# ============================================================================

# Get songs by genre (use a common genre or test data genre)
# Note: If test fixtures don't have genres, this might return empty array
GET {{base_url}}/ferrotune/songs/by-genre?genre=Test
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" isCollection

# Get songs by genre with count and offset
GET {{base_url}}/ferrotune/songs/by-genre?genre=Test&count=5&offset=0
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" isCollection

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/songs/by-genre?genre=test
HTTP 401
