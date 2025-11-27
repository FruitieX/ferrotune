# Authentication Tests
# Tests various authentication methods and error cases
# Note: This server returns HTTP 401 for auth failures rather than Subsonic API's HTTP 200 with error

# ============================================================================
# MISSING/INVALID AUTHENTICATION
# ============================================================================

# Test: Missing authentication parameters
GET {{base_url}}/rest/getArtists?v=1.16.1&c=hurl-test&f=xml
HTTP 401

# Test: Invalid password
GET {{base_url}}/rest/getArtists?u={{username}}&p=wrongpassword&v=1.16.1&c=hurl-test&f=xml
HTTP 401

# Test: Invalid username
GET {{base_url}}/rest/getArtists?u=nonexistent&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 401

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

# Test: Invalid API version (XML) - server returns 400 Bad Request
GET {{base_url}}/rest/ping?u={{username}}&p={{password}}&v=2.0.0&c=hurl-test&f=xml
HTTP 400

# Test: Invalid API version (JSON) - server returns 400 Bad Request
GET {{base_url}}/rest/ping?u={{username}}&p={{password}}&v=2.0.0&c=hurl-test&f=json
HTTP 400
