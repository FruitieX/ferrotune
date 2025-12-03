# Duplicate Detection API Tests
# Tests the /ferrotune/duplicates endpoint

# ============================================================================
# GET DUPLICATES - Empty Result
# ============================================================================

# Test: Get duplicates returns valid response structure
GET {{base_url}}/ferrotune/duplicates?u={{username}}&p={{password}}
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
GET {{base_url}}/ferrotune/duplicates?u={{username}}&p={{password}}
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
POST {{base_url}}/ferrotune/scan?u={{username}}&p={{password}}
Content-Type: application/json
```json
{
  "full": true
}
```
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"

# Test: Get duplicates after scan still returns valid structure
GET {{base_url}}/ferrotune/duplicates?u={{username}}&p={{password}}
HTTP 200
[Asserts]
jsonpath "$.groupCount" isInteger
jsonpath "$.totalDuplicates" isInteger
jsonpath "$.totalWastedBytes" isInteger
jsonpath "$.groups" isCollection
