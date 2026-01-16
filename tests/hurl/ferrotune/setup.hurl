# Ferrotune Setup Tests
# Tests for first-run setup endpoints
#
# Test Configuration:
# (no fixtures needed)

# ============================================================================
# SETUP STATUS
# ============================================================================

# Test: Get setup status (no auth required)
GET {{base_url}}/ferrotune/setup/status
HTTP 200
[Asserts]
jsonpath "$.setupComplete" isBoolean
jsonpath "$.hasUsers" isBoolean
jsonpath "$.hasMusicFolders" isBoolean
