# Duplicate Detection API Tests
# Tests the /api/duplicates endpoint
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# GET DUPLICATES - Empty Result
# ============================================================================

# Test: Get duplicates returns valid response structure
GET {{base_url}}/api/duplicates
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.groupCount" isInteger
jsonpath "$.totalDuplicates" isInteger
jsonpath "$.totalWastedBytes" isInteger
jsonpath "$.groups" isCollection

# ============================================================================
# DUPLICATES RESPONSE VALIDATION
# ============================================================================

# Test: Duplicates endpoint returns proper camelCase fields
GET {{base_url}}/api/duplicates
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
# Verify top-level structure
jsonpath "$.groupCount" >= 0
jsonpath "$.totalDuplicates" >= 0
jsonpath "$.totalWastedBytes" >= 0

# ============================================================================
# DUPLICATES AFTER SCAN
# ============================================================================

# Trigger a scan to ensure duplicates are detected
POST {{base_url}}/api/scan
Authorization: Basic {{auth_basic}}
Content-Type: application/json
```json
{
  "full": true
}
```
HTTP 202
[Asserts]
jsonpath "$.status" == "started"

# Test: Get duplicates after scan still returns valid structure
GET {{base_url}}/api/duplicates
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.groupCount" isInteger
jsonpath "$.totalDuplicates" isInteger
jsonpath "$.totalWastedBytes" isInteger
jsonpath "$.groups" isCollection
