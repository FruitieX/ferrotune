# Filesystem Browser API Tests
# Tests server filesystem browsing and validation
#
# Test Configuration:
# (no fixtures needed)

# ============================================================================
# BROWSE
# ============================================================================

# Browse roots (returns available drives/roots)
GET {{base_url}}/ferrotune/filesystem
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.directories" count >= 1
jsonpath "$.directories[0].path" exists

# Browse root directory explicitly
GET {{base_url}}/ferrotune/filesystem?path=/
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.path" == "/"
jsonpath "$.directories" isCollection
# Check standard unix dirs likely exist (etc, tmp, var, etc.)
# But can't guarantee specific ones, just checks list items structure
jsonpath "$.directories[0].name" exists
jsonpath "$.directories[0].readable" isBoolean

# Browse non-existent path
GET {{base_url}}/ferrotune/filesystem?path=/nonexistent-path-12345
Authorization: Basic {{auth_basic}}
HTTP 400
[Asserts]
jsonpath "$.error" contains "Path does not exist"

# ============================================================================
# VALIDATE
# ============================================================================

# Validate root path
GET {{base_url}}/ferrotune/filesystem/validate?path=/
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.valid" == true
jsonpath "$.exists" == true
jsonpath "$.isDirectory" == true
jsonpath "$.readable" == true

# Validate non-existent path
GET {{base_url}}/ferrotune/filesystem/validate?path=/nonexistent-path-12345
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.valid" == false
jsonpath "$.exists" == false
jsonpath "$.error" exists
