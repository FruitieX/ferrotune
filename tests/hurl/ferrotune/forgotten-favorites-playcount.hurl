# Forgotten favorites play count must reflect the SUM of scrobble
# play_count values, not the number of scrobble rows. Regression test
# for a bug where imported scrobbles (one row = many plays) showed the
# row count instead of the true play count in the forgotten-favorites
# view.
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

# Find a fixture song to import scrobbles for.
GET {{base_url}}/api/search?query=First
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_id: jsonpath "$.searchResult.song[0].id"

# Import two scrobble rows for the same song, each with playCount=6.
# This produces 2 rows whose SUM(play_count)=12, while COUNT(id)=2.
POST {{base_url}}/api/scrobbles/import
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
    "entries": [
        { "songId": "{{song_id}}", "playCount": 6 },
        { "songId": "{{song_id}}", "playCount": 6 }
    ]
}
HTTP 200

# Thresholds come from the user's forgotten-favorites preference. Above
# the song's 12 plays, it does not qualify.
PUT {{base_url}}/api/preferences/forgotten-favorites
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{ "value": { "minPlays": 13, "notPlayedSinceDays": 1 } }
HTTP 200

GET {{base_url}}/api/songs/forgotten-favorites?size=100
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.total" == 0

# The song should appear in forgotten-favorites (played_at is NULL, which
# counts as not played recently) with playCount=12 (the SUM), not 2.
# Other fixture songs have no scrobbles and are excluded by minPlays=1,
# so playCount=12 uniquely identifies the imported song.
PUT {{base_url}}/api/preferences/forgotten-favorites
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{ "value": { "minPlays": 1, "notPlayedSinceDays": 1 } }
HTTP 200

GET {{base_url}}/api/songs/forgotten-favorites?size=100
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song" count == 1
jsonpath "$.song[0].playCount" == 12
