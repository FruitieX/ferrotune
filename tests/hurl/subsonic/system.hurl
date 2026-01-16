# System API Tests
# Tests basic system endpoints: ping, getLicense, getOpenSubsonicExtensions, getMusicFolders
#
# Test Configuration:

# ============================================================================
# PING
# ============================================================================

# Test: Ping without authentication should return error in response body (per Subsonic spec, HTTP 200)
GET {{base_url}}/rest/ping?v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
jsonpath "$.subsonic-response.status" == "failed"
jsonpath "$.subsonic-response.error.code" == 40


# Test: Ping with valid authentication (XML - default)
GET {{base_url}}/rest/ping?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='subsonic-response']/@version)" startsWith "1."
xpath "string(//*[local-name()='subsonic-response']/@type)" == "ferrotune"
xpath "string(//*[local-name()='subsonic-response']/@openSubsonic)" == "true"

# Test: Ping with JSON format
GET {{base_url}}/rest/ping?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.version" startsWith "1."
jsonpath "$.subsonic-response.type" == "ferrotune"
jsonpath "$.subsonic-response.openSubsonic" == true

# ============================================================================
# GET LICENSE
# ============================================================================

# Test: getLicense (XML)
GET {{base_url}}/rest/getLicense?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "string(//*[local-name()='license']/@valid)" == "true"

# Test: getLicense (JSON)
GET {{base_url}}/rest/getLicense?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.valid" == true

# ============================================================================
# GET OPENSUBSONIC EXTENSIONS
# ============================================================================

# Test: getOpenSubsonicExtensions (XML)
GET {{base_url}}/rest/getOpenSubsonicExtensions?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='openSubsonicExtensions']" exists

# Test: getOpenSubsonicExtensions (JSON)
GET {{base_url}}/rest/getOpenSubsonicExtensions?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.openSubsonicExtensions" isCollection

# ============================================================================
# GET MUSIC FOLDERS
# ============================================================================

# Test: getMusicFolders (XML)
GET {{base_url}}/rest/getMusicFolders?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=xml
HTTP 200
[Asserts]
header "Content-Type" contains "application/xml"
xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
xpath "//*[local-name()='musicFolders']" exists

# Test: getMusicFolders (JSON)
GET {{base_url}}/rest/getMusicFolders?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.musicFolders.musicFolder" isCollection
