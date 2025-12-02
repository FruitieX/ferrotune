# Ferrotune Admin API - User Preferences Tests
# Tests for GET/PUT /ferrotune/preferences

# Test 1: Get default preferences (no preferences set yet)
GET http://localhost:4040/ferrotune/preferences
Authorization: Basic YWRtaW46YWRtaW4=
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "rust"

# Test 2: Update preferences with a preset color
PUT http://localhost:4040/ferrotune/preferences
Authorization: Basic YWRtaW46YWRtaW4=
Content-Type: application/json
{
  "accentColor": "ocean"
}
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "ocean"

# Test 3: Get preferences after update
GET http://localhost:4040/ferrotune/preferences
Authorization: Basic YWRtaW46YWRtaW4=
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "ocean"

# Test 4: Update preferences with custom color
PUT http://localhost:4040/ferrotune/preferences
Authorization: Basic YWRtaW46YWRtaW4=
Content-Type: application/json
{
  "accentColor": "custom",
  "customAccentHue": 200.5
}
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "custom"
jsonpath "$.customAccentHue" == 200.5

# Test 5: Invalid accent color returns 400
PUT http://localhost:4040/ferrotune/preferences
Authorization: Basic YWRtaW46YWRtaW4=
Content-Type: application/json
{
  "accentColor": "invalid-color"
}
HTTP 400
[Asserts]
jsonpath "$.error" contains "Invalid accent color"

# Test 6: Invalid custom hue (out of range) returns 400
PUT http://localhost:4040/ferrotune/preferences
Authorization: Basic YWRtaW46YWRtaW4=
Content-Type: application/json
{
  "accentColor": "custom",
  "customAccentHue": 500
}
HTTP 400
[Asserts]
jsonpath "$.error" contains "custom_accent_hue must be between 0 and 360"

# Test 7: Reset back to rust for clean state
PUT http://localhost:4040/ferrotune/preferences
Authorization: Basic YWRtaW46YWRtaW4=
Content-Type: application/json
{
  "accentColor": "rust"
}
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "rust"
