# Ferrotune Admin API - User Preferences Tests
# Tests for GET/PUT /ferrotune/preferences and individual preference endpoints

# Test 1: Get default preferences (no preferences set yet)
GET {{base_url}}/ferrotune/preferences
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "rust"
jsonpath "$.preferences" exists

# Test 2: Update preferences with a preset color
PUT {{base_url}}/ferrotune/preferences
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "accentColor": "ocean"
}
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "ocean"

# Test 3: Get preferences after update
GET {{base_url}}/ferrotune/preferences
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "ocean"

# Test 4: Update preferences with custom color
PUT {{base_url}}/ferrotune/preferences
Authorization: Basic {{auth_basic}}
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
PUT {{base_url}}/ferrotune/preferences
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "accentColor": "invalid-color"
}
HTTP 400
[Asserts]
jsonpath "$.error" contains "Invalid accent color"

# Test 6: Invalid custom hue (out of range) returns 400
PUT {{base_url}}/ferrotune/preferences
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "accentColor": "custom",
  "customAccentHue": 500
}
HTTP 400
[Asserts]
jsonpath "$.error" contains "custom_accent_hue must be between 0 and 360"

# Test 7: Reset back to rust for clean state
PUT {{base_url}}/ferrotune/preferences
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "accentColor": "rust"
}
HTTP 200
[Asserts]
jsonpath "$.accentColor" == "rust"

# Test 8: Set individual preference (boolean value)
PUT {{base_url}}/ferrotune/preferences/sidebar-collapsed
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "value": true
}
HTTP 200
[Asserts]
jsonpath "$.key" == "sidebar-collapsed"
jsonpath "$.value" == true

# Test 9: Get individual preference
GET {{base_url}}/ferrotune/preferences/sidebar-collapsed
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.key" == "sidebar-collapsed"
jsonpath "$.value" == true

# Test 10: Set individual preference (object value)
PUT {{base_url}}/ferrotune/preferences/library-sort
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "value": {"field": "name", "direction": "desc"}
}
HTTP 200
[Asserts]
jsonpath "$.key" == "library-sort"
jsonpath "$.value.field" == "name"
jsonpath "$.value.direction" == "desc"

# Test 11: Get complex preference
GET {{base_url}}/ferrotune/preferences/library-sort
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.key" == "library-sort"
jsonpath "$.value.field" == "name"
jsonpath "$.value.direction" == "desc"

# Test 12: Delete individual preference (returns 204 No Content)
DELETE {{base_url}}/ferrotune/preferences/sidebar-collapsed
Authorization: Basic {{auth_basic}}
HTTP 204

# Test 13: Get deleted preference returns null
GET {{base_url}}/ferrotune/preferences/sidebar-collapsed
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.key" == "sidebar-collapsed"
jsonpath "$.value" == null

# Test 14: Preferences are included in the main get response
GET {{base_url}}/ferrotune/preferences
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.preferences.library-sort.field" == "name"
jsonpath "$.preferences.library-sort.direction" == "desc"

# Test 15: Clean up - delete remaining preferences
DELETE {{base_url}}/ferrotune/preferences/library-sort
Authorization: Basic {{auth_basic}}
HTTP 204
