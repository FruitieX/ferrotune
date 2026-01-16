# Ferrotune History Tests
# Tests for play history endpoint
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# ============================================================================
# PLAY HISTORY
# ============================================================================

# Test: Get play history
GET {{base_url}}/ferrotune/history
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.entry" isCollection
jsonpath "$.total" isNumber
