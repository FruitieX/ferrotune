# User Management API Tests
# Tests CRUD operations for users and library access
#
# Test Configuration:

# ============================================================================
# GET CURRENT USER (/me)
# ============================================================================

# Get current user info - any authenticated user can access this
GET {{base_url}}/api/users/me
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.id" exists
jsonpath "$.username" == "{{username}}"
jsonpath "$.isAdmin" exists
jsonpath "$.libraryAccess" exists

# Unauthenticated request should fail
GET {{base_url}}/api/users/me
HTTP 401

# ============================================================================
# LIST USERS
# ============================================================================

# Get list of users (initially just the admin)
GET {{base_url}}/api/users
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.users" count >= 1
jsonpath "$.users[0].username" exists

# ============================================================================
# CREATE USER
# ============================================================================

# Create a new user
POST {{base_url}}/api/users
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
GET {{base_url}}/api/users
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.users" count >= 2

# ============================================================================
# GET SINGLE USER
# ============================================================================

# Get the created user
GET {{base_url}}/api/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.id" == {{new_user_id}}
jsonpath "$.username" == "testuser"
jsonpath "$.isAdmin" == false
jsonpath "$.libraryAccess" exists

# Get nonexistent user
GET {{base_url}}/api/users/99999
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" contains "User 99999 not found"

# ============================================================================
# UPDATE USER
# ============================================================================

# Update username
PATCH {{base_url}}/api/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "username": "testuser_updated"
}
HTTP 200
[Asserts]
jsonpath "$.username" == "testuser_updated"

# Verify update
GET {{base_url}}/api/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.username" == "testuser_updated"

# Update isAdmin flag
PATCH {{base_url}}/api/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "isAdmin": true
}
HTTP 200
[Asserts]
jsonpath "$.isAdmin" == true

# Update password
PATCH {{base_url}}/api/users/{{new_user_id}}
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
GET {{base_url}}/api/users/{{new_user_id}}/library-access
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.userId" == {{new_user_id}}
jsonpath "$.folderIds" exists

# Update library access (set to empty)
PUT {{base_url}}/api/users/{{new_user_id}}/library-access
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "folderIds": []
}
HTTP 200
[Asserts]
jsonpath "$.folderIds" isEmpty

# ============================================================================
# DELETE USER
# ============================================================================

# Delete the test user
DELETE {{base_url}}/api/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

# Verify deletion
GET {{base_url}}/api/users/{{new_user_id}}
Authorization: Basic {{auth_basic}}
HTTP 404
[Asserts]
jsonpath "$.error" contains "User {{new_user_id}} not found"

# ============================================================================
# ERROR CASES
# ============================================================================

# Try to create user with duplicate username (using the admin username from test server)
POST {{base_url}}/api/users
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
GET {{base_url}}/api/users
HTTP 401
