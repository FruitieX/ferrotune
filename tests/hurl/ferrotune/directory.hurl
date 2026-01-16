# Ferrotune Directory Browsing Tests
# Tests for directory browsing endpoints
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# LIBRARIES
# ============================================================================

# Test: Get all libraries (music folders)
GET {{base_url}}/ferrotune/libraries
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.libraries" isCollection

# ============================================================================
# DIRECTORY CONTENTS
# ============================================================================

# Test: Get directory contents requires libraryId
GET {{base_url}}/ferrotune/directory
Authorization: Basic {{auth_basic}}
HTTP 400

# First get a library ID
GET {{base_url}}/ferrotune/libraries
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
lib_id: jsonpath "$.libraries[0].id"

# Test: Get directory contents at root
GET {{base_url}}/ferrotune/directory?libraryId={{lib_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.children" isCollection
jsonpath "$.total" isInteger
jsonpath "$.folderCount" isInteger
jsonpath "$.fileCount" isInteger
