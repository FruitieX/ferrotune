# User Management API Tests
# Tests CRUD operations for users, library access, and API keys
#
# Test Configuration:

# ============================================================================
# GET CURRENT USER (/me)
# ============================================================================

# Get current user info - any authenticated user can access this
GET {{base_url}}/ferrotune/users/me
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.id" exists
jsonpath "$.username" == "{{username}}"
jsonpath "$.isAdmin" exists
jsonpath "$.libraryAccess" exists

# Unauthenticated request should fail
GET {{base_url}}/ferrotune/users/me
HTTP 401

# ============================================================================
# LIST USERS
# ============================================================================

# Get list of users (initially just the admin)
GET {{base_url}}/ferrotune/users
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.users" count >= 1
jsonpath "$.users[0].username" exists

# ============================================================================
# CREATE USER
# ============================================================================

# Create a new user
POST {{base_url}}/ferrotune/users
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "username": "testuser",
  "password": "testpass123",
  "isAdmin": false
}
HTTP 201
[Captures]
new_user_id: jsonpath "$.id"
[Asserts]
jsonpath "$.username" == "testuser"
jsonpath "$.id" exists

# Verify user was created by listing again
GET {{base_url}}/ferrotune/users
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.users" count >= 2

# ============================================================================
# GET SINGLE USER
# ============================================================================

# Get the created user
GET {{base_url}}/ferrotune/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.id" == {{new_user_id}}
jsonpath "$.username" == "testuser"
jsonpath "$.isAdmin" == false
jsonpath "$.libraryAccess" exists

# Get nonexistent user
GET {{base_url}}/ferrotune/users/99999
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" contains "User 99999 not found"

# ============================================================================
# UPDATE USER
# ============================================================================

# Update username
PATCH {{base_url}}/ferrotune/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "username": "testuser_updated"
}
HTTP 200
[Asserts]
jsonpath "$.username" == "testuser_updated"

# Verify update
GET {{base_url}}/ferrotune/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.username" == "testuser_updated"

# Update isAdmin flag
PATCH {{base_url}}/ferrotune/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "isAdmin": true
}
HTTP 200
[Asserts]
jsonpath "$.isAdmin" == true

# Update password
PATCH {{base_url}}/ferrotune/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "password": "newpassword123"
}
HTTP 200

# ============================================================================
# LIBRARY ACCESS
# ============================================================================

# Get library access for user
GET {{base_url}}/ferrotune/users/{{new_user_id}}/library-access
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.userId" == {{new_user_id}}
jsonpath "$.folderIds" exists

# Update library access (set to empty)
PUT {{base_url}}/ferrotune/users/{{new_user_id}}/library-access
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "folderIds": []
}
HTTP 200
[Asserts]
jsonpath "$.folderIds" isEmpty

# ============================================================================
# API KEYS
# ============================================================================

# Get API keys (empty initially for new user)
GET {{base_url}}/ferrotune/users/{{new_user_id}}/api-keys
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.apiKeys" exists

# Create an API key
POST {{base_url}}/ferrotune/users/{{new_user_id}}/api-keys
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Test API Key"
}
HTTP 201
[Captures]
api_key: jsonpath "$.key"
[Asserts]
jsonpath "$.key" exists
jsonpath "$.name" == "Test API Key"

# Verify API key was created
GET {{base_url}}/ferrotune/users/{{new_user_id}}/api-keys
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.apiKeys" count >= 1
jsonpath "$.apiKeys[0].name" == "Test API Key"

# Delete API key
DELETE {{base_url}}/ferrotune/users/{{new_user_id}}/api-keys/Test%20API%20Key
Authorization: Basic {{auth_basic}}
HTTP 204

# Verify deletion
GET {{base_url}}/ferrotune/users/{{new_user_id}}/api-keys
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.apiKeys" count == 0

# ============================================================================
# DELETE USER
# ============================================================================

# Delete the test user
DELETE {{base_url}}/ferrotune/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

# Verify deletion
GET {{base_url}}/ferrotune/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" contains "User {{new_user_id}} not found"

# ============================================================================
# ERROR CASES
# ============================================================================

# Try to create user with duplicate username (using the admin username from test server)
POST {{base_url}}/ferrotune/users
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "username": "{{username}}",
  "password": "test12345678",
  "isAdmin": false
}
HTTP 400
[Asserts]
jsonpath "$.error" contains "already taken"

# Unauthorized access (no auth)
GET {{base_url}}/ferrotune/users
HTTP 401
