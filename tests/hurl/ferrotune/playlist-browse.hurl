# Playlist browser listing: server-side filtering and sorting
#
# Test Configuration:
# @requires_fixtures
# @requires_scan

GET {{base_url}}/api/songs/random?size=2
Authorization: Basic {{auth_basic}}
HTTP 200
[Captures]
song_a: jsonpath "$.song[0].id"
song_b: jsonpath "$.song[1].id"

POST {{base_url}}/api/playlist-folders
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Browse Folder"
}
HTTP 200
[Captures]
browse_folder_id: jsonpath "$.id"

# "Browse Zebra" holds two songs, "Browse apple" one
POST {{base_url}}/api/playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Browse Zebra",
  "entries": [{ "songId": "{{song_a}}" }, { "songId": "{{song_b}}" }]
}
HTTP 200
[Captures]
zebra_id: jsonpath "$.playlistId"

POST {{base_url}}/api/playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Browse apple",
  "comment": "fruity",
  "entries": [{ "songId": "{{song_a}}" }]
}
HTTP 200
[Captures]
apple_id: jsonpath "$.playlistId"

POST {{base_url}}/api/smart-playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Browse Middle Smart",
  "isPublic": false,
  "rules": { "logic": "and", "conditions": [] }
}
HTTP 201
[Captures]
smart_id: jsonpath "$.id"

# Nested playlist that only shows up inside its folder (or recursively)
POST {{base_url}}/api/playlists
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "name": "Browse Nested",
  "entries": []
}
HTTP 200
[Captures]
nested_id: jsonpath "$.playlistId"

PATCH {{base_url}}/api/playlists/{{nested_id}}/move
Authorization: Basic {{auth_basic}}
Content-Type: application/json
{
  "folderId": "{{browse_folder_id}}"
}
HTTP 204

# Root level, filtered: folders by name, playlists and smart playlists mixed
# by name (case-insensitive)
GET {{base_url}}/api/playlists/browse?filter=browse
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.folders" count == 1
jsonpath "$.folders[0].name" == "Browse Folder"
jsonpath "$.items" count == 3
jsonpath "$.items[0].smartPlaylist" == null
jsonpath "$.items[0].playlist.name" == "Browse apple"
jsonpath "$.items[1].playlist" == null
jsonpath "$.items[1].smartPlaylist.name" == "Browse Middle Smart"
jsonpath "$.items[2].playlist.name" == "Browse Zebra"

# Descending song count
GET {{base_url}}/api/playlists/browse?filter=browse&sort=songCount&sortDir=desc
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.items[0].playlist.name" == "Browse Zebra"
jsonpath "$.items[1].playlist.name" == "Browse apple"

# Comment matches too
GET {{base_url}}/api/playlists/browse?filter=FRUITY
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.folders" count == 0
jsonpath "$.items" count == 1
jsonpath "$.items[0].playlist.id" == "{{apple_id}}"

# Inside the folder
GET {{base_url}}/api/playlists/browse?folderId={{browse_folder_id}}
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.folders" count == 0
jsonpath "$.items" count == 1
jsonpath "$.items[0].playlist.id" == "{{nested_id}}"

# Recursive search across folders, without folders
GET {{base_url}}/api/playlists/browse?recursive=true&filter=nested
Authorization: Basic {{auth_basic}}
HTTP 200
[Asserts]
jsonpath "$.folders" count == 0
jsonpath "$.items" count == 1
jsonpath "$.items[0].playlist.id" == "{{nested_id}}"

GET {{base_url}}/api/playlists/browse
HTTP 401

# Cleanup
DELETE {{base_url}}/api/playlists/{{zebra_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

DELETE {{base_url}}/api/playlists/{{apple_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

DELETE {{base_url}}/api/playlists/{{nested_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

DELETE {{base_url}}/api/smart-playlists/{{smart_id}}
Authorization: Basic {{auth_basic}}
HTTP 204

DELETE {{base_url}}/api/playlist-folders/{{browse_folder_id}}
Authorization: Basic {{auth_basic}}
HTTP 204
