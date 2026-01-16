# Ferrotune Core API Tests
# Tests for health, stats, scan, and other core endpoints
#
# Test Configuration:
# (no fixtures needed for health/stats)

# ============================================================================
# HEALTH CHECK
# ============================================================================

# Test: Health endpoint returns OK (no auth required)
GET {{base_url}}/ferrotune/health
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"
jsonpath "$.version" exists

# ============================================================================
# SERVER STATS
# ============================================================================

# Test: Stats endpoint requires authentication
GET {{base_url}}/ferrotune/stats
HTTP 401

# Test: Stats endpoint returns counts
GET {{base_url}}/ferrotune/stats
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songCount" isInteger
jsonpath "$.albumCount" isInteger
jsonpath "$.artistCount" isInteger
jsonpath "$.genreCount" isInteger
jsonpath "$.playlistCount" isInteger
jsonpath "$.totalDurationSeconds" isInteger
jsonpath "$.totalSizeBytes" isInteger
jsonpath "$.totalPlays" isInteger

# ============================================================================
# PING (Ferrotune variant)
# ============================================================================

# Test: Ping returns OK
GET {{base_url}}/ferrotune/ping
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"
