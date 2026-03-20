# OpenSubsonic API Implementation Status

This document tracks the implementation status of OpenSubsonic API endpoints in Ferrotune.

## ✅ Implemented Endpoints (34)

### System
- `ping` - Server health check
- `getLicense` - License info (always returns valid)
- `getOpenSubsonicExtensions` - Supported extensions
- `getMusicFolders` - Configured music directories
- `startScan` - Trigger library scan
- `getScanStatus` - Check scan progress

### Browse
- `getArtists` - Artist index with album counts
- `getArtist` - Artist details with albums
- `getArtistInfo2` - Artist metadata ⚠️ stub (returns empty)
- `getAlbum` - Album with songs
- `getSong` - Single song details
- `getGenres` - Available genres
- `getSimilarSongs2` - Similar songs via bliss audio analysis
- `getIndexes` - Directory-based artist browsing
- `getMusicDirectory` - Directory listing for artist/album

### Media
- `stream` - Audio streaming with HTTP range requests and transcoding
- `download` - File download
- `getCoverArt` - Album artwork with inline thumbnail support

### Annotation
- `star` - Star songs/albums/artists
- `unstar` - Remove stars
- `setRating` - Rate items 1-5 (0 removes rating)
- `getStarred` - List starred items
- `getStarred2` - List starred items (ID3 format)
- `scrobble` - Track play history (with optional Last.fm forwarding)

### Lists
- `getAlbumList` - Non-ID3 album lists
- `getAlbumList2` - Album lists by various criteria (ID3)
- `getRandomSongs` - Random song selection
- `getSongsByGenre` - Filter songs by genre

### Search
- `search3` - Full-text search with fuzzy fallback

### Playlists
- `getPlaylists` - List all playlists
- `getPlaylist` - Playlist details with songs
- `createPlaylist` - Create new playlist
- `updatePlaylist` - Modify playlist
- `deletePlaylist` - Remove playlist

### Play Queue ⚠️ Stub Implementation
- `savePlayQueue` - Save current play queue (returns success without persisting)
- `getPlayQueue` - Retrieve play queue (always returns empty)

### History (Ferrotune Extension)
- `getPlayHistory` - Play history with pagination

### Transcoding (OpenSubsonic Extension)
- `getTranscodeDecision` - Negotiate transcoding parameters
- `getTranscodeStream` - Transcoded audio streaming

---

## ❌ Missing Endpoints

### Medium Priority
| Endpoint | Purpose |
|----------|---------|
| `getAlbumInfo2` | External album metadata |
| `getArtistInfo` | External artist metadata (non-ID3) |
| `getTopSongs` | Top songs for artist |
| `getNowPlaying` | Currently playing |
| `getLyricsBySongId` | Song lyrics |

### User Management
| Endpoint | Purpose |
|----------|---------|
| `getUser` | User details |
| `getUsers` | List all users |
| `createUser` | Create user |
| `updateUser` | Modify user |
| `deleteUser` | Remove user |
| `changePassword` | Password change |

### Bookmarks
| Endpoint | Purpose |
|----------|---------|
| `getBookmarks` | Position bookmarks |
| `createBookmark` | Save position |
| `deleteBookmark` | Remove bookmark |

### Sharing
| Endpoint | Purpose |
|----------|---------|
| `getShares` | Public share links |
| `createShare` | Create share |
| `updateShare` | Modify share |
| `deleteShare` | Remove share |

### Low Priority
- Internet radio stations
- Podcasts
- Video support
- Chat (deprecated)
- Jukebox control
