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

# The song should appear in forgotten-favorites (played_at is NULL,
# notPlayedSinceDays=0 includes None) with playCount=12 (the SUM), not 2.
# Other fixture songs have no scrobbles and are excluded by minPlays=1,
# so playCount=12 uniquely identifies the imported song.
GET {{base_url}}/api/songs/forgotten-favorites?minPlays=1&notPlayedSinceDays=0&size=100
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.song[*].playCount" contains 12
