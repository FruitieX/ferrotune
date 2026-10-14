# Ferrotune Push Device Tests
# Push wake-ups for idle native apps. The test server runs without
# FERROTUNE_FCM_SERVICE_ACCOUNT, so push messaging is off: the server says so,
# refuses registrations, and handing playback to a device still works.

# Test: ping tells native apps not to register for push
GET {{base_url}}/api/ping
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.pushEnabled" == false

# Test: registering a push token is refused while push is not configured
PUT {{base_url}}/api/push/device
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "clientId": "hurl-phone",
  "token": "hurl-fcm-token",
  "deviceLabel": "Hurl Phone"
}
HTTP 404

# Test: unregistering is always allowed (sign-out), even with nothing registered
DELETE {{base_url}}/api/push/device/hurl-phone
Authorization: Basic {{auth_basic}}
HTTP 204

# Create a playback session
POST {{base_url}}/api/sessions
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "clientName": "ferrotune-web",
  "clientId": "hurl-push-web"
}
HTTP 200
[Captures]
push_session_id: jsonpath "$.id"

# Test: handing playback to another device with a wake request succeeds
POST {{base_url}}/api/sessions/{{push_session_id}}/command
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "action": "takeOver",
  "clientName": "ferrotune-mobile",
  "clientId": "hurl-phone",
  "resumePlayback": true,
  "positionMs": 12000,
  "wakeTarget": true
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# Test: without push, no idle devices are listed
GET {{base_url}}/api/sessions/clients
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.clients[?(@.isIdle == true)]" count == 0

# Test: remote commands to an owner that cannot be woken by push still succeed
POST {{base_url}}/api/sessions/{{push_session_id}}/command
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "action": "play"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
