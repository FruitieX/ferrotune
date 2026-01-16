# Authentication Tests
#
# Test Configuration:
# Tests various authentication methods and error cases
# Note: Per the Subsonic API spec, errors are returned with HTTP 200 and error details in the body

# ============================================================================
# MISSING/INVALID AUTHENTICATION
# ============================================================================

# Test: Missing authentication parameters (error code 40 = auth failure)
GET {{base_url}}/rest/getArtists?v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 40

# Test: Invalid password (error code 40 = wrong username or password)
GET {{base_url}}/rest/getArtists?u={{username}}&p=wrongpassword&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 40

# Test: Invalid username (error code 40 = wrong username or password)
GET {{base_url}}/rest/getArtists?u=nonexistent&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 40

# ============================================================================
# VALID AUTHENTICATION
# ============================================================================

# Test: Valid password authentication (XML)
GET {{base_url}}/rest/getArtists?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: Valid password authentication (JSON)
GET {{base_url}}/rest/getArtists?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# HEX-ENCODED PASSWORD
# ============================================================================

# Test: Hex-encoded password (XML)
# enc:74657374706173730a = hex("testpass\n") - adjust based on actual password
GET {{base_url}}/rest/ping?u={{username}}&p=enc:{{password_hex}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"

# Test: Hex-encoded password (JSON)
GET {{base_url}}/rest/ping?u={{username}}&p=enc:{{password_hex}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"

# ============================================================================
# INVALID API VERSION
# ============================================================================

# Test: Invalid API version (JSON) - error code 10 = bad request
GET {{base_url}}/rest/ping?u={{username}}&p={{password}}&v=2.0.0&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 10
