# GET /api/starred must load starred songs whose only plays are imported
# play counts (`played_at` NULL, `play_count` > 1). Regression test for a
# 500 where the play-stats query decoded MAX(played_at) as non-null; it
# also checks that playCount is the SUM of imported counts.
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

GET {{base_url}}/api/search?query=First
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.searchResult.song[0].id"

POST {{base_url}}/api/scrobbles/import
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "entries": [
        { "songId": "{{song_id}}", "playCount": 4 },
        { "songId": "{{song_id}}", "playCount": 3 }
    ]
}
HTTP 200

POST {{base_url}}/api/star
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{ "id": ["{{song_id}}"] }
HTTP 204

GET {{base_url}}/api/starred
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.songs[?(@.id == '{{song_id}}')].playCount" == 7
jsonpath "$.songs[?(@.id == '{{song_id}}')].lastPlayed" not exists
jsonpath "$.songs[?(@.id == '{{song_id}}')].album" isString
