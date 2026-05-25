# Ferrotune Scan API Tests
# Tests for library scanning endpoints
#
# Test Configuration:
# @requires_fixtures

# ============================================================================
# SCAN STATUS
# ============================================================================

# Test: Get scan status when not scanning
GET {{base_url}}/api/scan/status
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.scanning" isBoolean

# Test: Get full scan status
GET {{base_url}}/api/scan/full
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.scanning" isBoolean

# Test: Get scan details endpoint
GET {{base_url}}/api/scan/details
Authorization: Basic {{auth_basic}}
HTTP 200

# ============================================================================
# TRIGGER SCAN
# ============================================================================

# Test: Trigger a library scan
POST {{base_url}}/api/scan
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{}
HTTP 202
[Asserts]
jsonpath "$.status" == "started"
jsonpath "$.message" exists

# Wait a moment and check progress
GET {{base_url}}/api/scan/status
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.scanning" isBoolean

# ============================================================================
# SCAN LOGS
# ============================================================================

# Test: Get scan logs
GET {{base_url}}/api/scan/logs
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.logs" isCollection
