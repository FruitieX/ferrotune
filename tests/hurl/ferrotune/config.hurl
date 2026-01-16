# Ferrotune Server Configuration Tests
# Tests for server configuration endpoints (admin only)
#
# Test Configuration:
# (no fixtures needed)

# ============================================================================
# GET SERVER CONFIGURATION
# ============================================================================

# Test: Get server config requires auth
GET {{base_url}}/ferrotune/config
HTTP 401

# Test: Get server config
GET {{base_url}}/ferrotune/config
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.serverName" exists
jsonpath "$.serverHost" exists
jsonpath "$.serverPort" isInteger
jsonpath "$.adminUser" exists
jsonpath "$.readonlyTags" isBoolean
jsonpath "$.allowFileDeletion" isBoolean
jsonpath "$.configured" isBoolean

# ============================================================================
# GET ALL CONFIG
# ============================================================================

# Test: Get all config as key-value pairs (returns flat object)
GET {{base_url}}/ferrotune/config/all
Authorization: Basic {{auth_basic}}
HTTP 200

# ============================================================================
# UPDATE SERVER CONFIGURATION
# ============================================================================

# Test: Update readonlyTags setting
PUT {{base_url}}/ferrotune/config
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "readonlyTags": true
}
HTTP 200
[Asserts]
jsonpath "$.readonlyTags" == true

# Restore setting
PUT {{base_url}}/ferrotune/config
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "readonlyTags": false
}
HTTP 200
[Asserts]
jsonpath "$.readonlyTags" == false
